import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { AlertCircle, CheckCircle2, ExternalLink, LocateFixed, MapPin, Navigation } from "lucide-react";
import "leaflet/dist/leaflet.css";

// Several public Overpass mirrors; the first one that answers wins.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];
const OVERPASS_TIMEOUT_MS = 15000;

// If the first tile host keeps failing the map quietly switches to the next one.
const TILE_SOURCES = [
  { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", attribution: "Tiles &copy; Esri — Sources: Esri, HERE, Garmin, OpenStreetMap contributors" },
  { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "&copy; OpenStreetMap contributors" }
];
const TILE_ERRORS_BEFORE_SWITCH = 4;

const RADIUS_OPTIONS = [{ m: 500, label: "500 m" }, { m: 1000, label: "1 km" }, { m: 2000, label: "2 km" }, { m: 3000, label: "3 km" }];
const FILTERS = [
  { id: "all", label: "All" }, { id: "police", label: "Police" }, { id: "health", label: "Hospitals" },
  { id: "pharmacy", label: "Pharmacies" }, { id: "shop", label: "Shops" }, { id: "transport", label: "Transport" }
];
const MAX_PER_KIND = 15;
const REQUERY_DISTANCE_M = 150; // moving less than this never triggers a new search

const escapeHtml = (value = "") => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const icon = (kind, selected = false) => L.divIcon({
  className: "saathi-map-icon",
  html: `<div class="map-marker ${selected ? "selected" : ""} ${kind || "other"}"><span></span></div>`,
  iconSize: [24, 30],
  iconAnchor: [12, 26]
});

function placeKind(tags = {}) {
  if (tags.amenity === "hospital" || tags.amenity === "clinic") return "health";
  if (tags.amenity === "police") return "police";
  if (tags.amenity === "pharmacy") return "pharmacy";
  if (tags.shop) return "shop";
  if (tags.public_transport || tags.railway || tags.amenity === "bus_station") return "transport";
  return "other";
}

function placeLabel(tags = {}) {
  if (tags.amenity === "hospital") return "Hospital";
  if (tags.amenity === "clinic") return "Clinic";
  if (tags.amenity === "police") return "Police station";
  if (tags.amenity === "pharmacy") return "Pharmacy";
  if (tags.shop) return "Shop";
  if (tags.public_transport || tags.railway || tags.amenity === "bus_station") return "Transport";
  return tags.amenity || "Public place";
}

// Roughly matches the real uncertainty of the fix: laptop Wi-Fi/IP positions can be kilometres off.
const zoomForAccuracy = (r) => (r > 2000 ? 13 : r > 500 ? 14 : 15);

// NOTE: the old query ended in `out tags;`, which returns NO coordinates, so every result was
// discarded and the list was always empty. `out center` returns lat/lon for nodes and a centre
// point for ways/areas (hospitals and police stations are often mapped as buildings/areas).
const buildQuery = (lat, lng, radius) => `[out:json][timeout:20];(` +
  `nwr(around:${radius},${lat},${lng})[amenity~"^(hospital|clinic|pharmacy|police|bus_station)$"];` +
  `nwr(around:${radius},${lat},${lng})[railway~"^(station|halt)$"];` +
  `nwr(around:${Math.min(radius, 1500)},${lat},${lng})[shop~"^(convenience|supermarket)$"];` +
  `);out center 200;`;

async function fetchOverpass(query, signal) {
  const failures = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener("abort", onAbort);
    const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { result: await response.json(), failures };
    } catch (e) {
      if (signal.aborted) return { result: null, failures, cancelled: true };
      failures.push(e.name === "AbortError" ? "timeout" : (e.message || "request failed"));
    } finally {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
    }
  }
  return { result: null, failures };
}

export default function MapView({ location, locationStatus, onLocate, compact = false, large = false, loadNearby = !compact }) {
  const mapNode = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const routeRef = useRef(null);
  const locationMarkerRef = useRef(null);
  const accuracyRef = useRef(null);
  const centeredRef = useRef(false);
  const [places, setPlaces] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tileNotice, setTileNotice] = useState("");
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [radius, setRadius] = useState(1000);
  const [filter, setFilter] = useState("all");
  const [searchCenter, setSearchCenter] = useState(null);

  const hasLocation = Boolean(location && Number.isFinite(location.lat) && Number.isFinite(location.lng));
  const visiblePlaces = filter === "all" ? places : places.filter(p => p.kind === filter);

  // 1. Create the map once. A ResizeObserver keeps it correctly sized when the layout changes
  //    (sidebar, tabs, mobile rotation), which is the usual cause of grey or cut-off tiles.
  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const start = hasLocation ? [location.lat, location.lng] : [20.5937, 78.9629];
    const map = L.map(mapNode.current, { zoomControl: true, scrollWheelZoom: !compact }).setView(start, hasLocation ? 14 : 4);
    let sourceIndex = 0;
    let errors = 0;
    let layer = null;
    let disposed = false;
    const mountTiles = (index) => {
      const source = TILE_SOURCES[index];
      layer = L.tileLayer(source.url, { maxZoom: 19, attribution: source.attribution }).addTo(map);
      layer.on("tileerror", () => {
        errors += 1;
        if (errors >= TILE_ERRORS_BEFORE_SWITCH && sourceIndex < TILE_SOURCES.length - 1 && !disposed) {
          map.removeLayer(layer);
          sourceIndex += 1;
          errors = 0;
          mountTiles(sourceIndex);
          setTileNotice("The default map tiles did not load, so the map switched to OpenStreetMap tiles.");
        }
      });
    };
    mountTiles(0);
    mapRef.current = map;
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.invalidateSize()) : null;
    observer?.observe(mapNode.current);
    const settle = setTimeout(() => map.invalidateSize(), 250);
    return () => {
      disposed = true;
      clearTimeout(settle);
      observer?.disconnect();
      map.remove();
      mapRef.current = null;
      markersRef.current = [];
      routeRef.current = null;
      locationMarkerRef.current = null;
      accuracyRef.current = null;
      centeredRef.current = false;
    };
  }, []);

  // 2. Show the device position with its real accuracy. The view only jumps on the first fix, so
  //    live updates never fight the user's panning or a route that is being shown.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasLocation) return;
    const latlng = [location.lat, location.lng];
    if (!locationMarkerRef.current) {
      locationMarkerRef.current = L.circleMarker(latlng, { radius: 9, color: "#ffffff", weight: 4, fillColor: "#e45c70", fillOpacity: 1 })
        .addTo(map).bindPopup("Device location<br/>Captured with browser permission");
    } else {
      locationMarkerRef.current.setLatLng(latlng);
    }
    const r = Math.min(Math.max(Number(location.accuracy) || 0, 0), 5000);
    if (r > 30) {
      if (!accuracyRef.current) {
        accuracyRef.current = L.circle(latlng, { radius: r, color: "#e45c70", weight: 1, fillColor: "#e45c70", fillOpacity: 0.08, interactive: false }).addTo(map);
      } else {
        accuracyRef.current.setLatLng(latlng);
        accuracyRef.current.setRadius(r);
      }
    } else if (accuracyRef.current) {
      accuracyRef.current.remove();
      accuracyRef.current = null;
    }
    if (!centeredRef.current) {
      map.setView(latlng, zoomForAccuracy(r), { animate: true });
      centeredRef.current = true;
    }
  }, [hasLocation, location?.lat, location?.lng, location?.accuracy]);

  const recenter = () => {
    if (!mapRef.current || !hasLocation) return;
    mapRef.current.setView([location.lat, location.lng], zoomForAccuracy(Number(location.accuracy) || 0), { animate: true });
  };

  // 3. Only search again after moving a meaningful distance (or on retry), not on every GPS tick.
  useEffect(() => {
    if (!loadNearby || !hasLocation) return;
    setSearchCenter(prev => (!prev || L.latLng(prev.lat, prev.lng).distanceTo([location.lat, location.lng]) > REQUERY_DISTANCE_M)
      ? { lat: location.lat, lng: location.lng } : prev);
  }, [loadNearby, hasLocation, location?.lat, location?.lng]);

  useEffect(() => {
    if (!loadNearby || !searchCenter) return;
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError("");
      const { result, failures, cancelled } = await fetchOverpass(buildQuery(searchCenter.lat, searchCenter.lng, radius), controller.signal);
      if (cancelled || controller.signal.aborted) return;
      setLoading(false);
      if (!result) {
        setError(`Live nearby-place data is temporarily unavailable (${failures.join("; ")}). You can retry or load clearly labelled demo markers for the presentation.`);
        return;
      }
      const origin = L.latLng(searchCenter.lat, searchCenter.lng);
      const normalized = (result.elements || []).map(el => {
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const tags = el.tags || {};
        return { id: `${el.type}-${el.id}`, name: tags.name || tags.brand || placeLabel(tags), kind: placeKind(tags), category: placeLabel(tags), lat, lng, distance: origin.distanceTo([lat, lng]), tags, source: "live" };
      }).filter(Boolean).sort((a, b) => a.distance - b.distance);
      // Keep the nearest few of each kind so a street full of shops cannot hide the police station.
      const counts = {};
      const balanced = normalized.filter(p => (counts[p.kind] = (counts[p.kind] || 0) + 1) <= MAX_PER_KIND);
      setPlaces(balanced);
      setSelected(null);
      setRouteInfo(null);
      if (routeRef.current) { routeRef.current.remove(); routeRef.current = null; }
      if (!balanced.length) setError("The live map service returned no matching places in this search area. Try a larger radius; map coverage may be incomplete.");
    })();
    return () => controller.abort();
  }, [loadNearby, searchCenter, radius, retryCount]);

  // 4. Markers follow the active filter.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (!hasLocation) return;
    visiblePlaces.forEach(place => {
      const marker = L.marker([place.lat, place.lng], { icon: icon(place.kind, selected?.id === place.id) })
        .addTo(map)
        .bindPopup(`<strong>${escapeHtml(place.name)}</strong><br/>${escapeHtml(place.category)}<br/>${(place.distance / 1000).toFixed(1)} km away`);
      marker.on("click", () => { setSelected(place); clearRoute(); });
      markersRef.current.push(marker);
    });
  }, [places, filter, selected?.id, hasLocation]);

  const clearRoute = () => {
    setRouteInfo(null);
    if (routeRef.current) { routeRef.current.remove(); routeRef.current = null; }
  };

  const choosePlace = (place) => {
    setSelected(place);
    clearRoute();
    if (mapRef.current) mapRef.current.setView([place.lat, place.lng], 16, { animate: true });
  };

  const showRoute = async () => {
    if (!hasLocation || !selected || selected.source === "demo") return;
    setRouteLoading(true); setError("");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      const url = `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${location.lng},${location.lat};${selected.lng},${selected.lat}?overview=full&geometries=geojson`;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error("The route service is unavailable right now.");
      const data = await response.json();
      const route = data.routes?.[0];
      if (!route) throw new Error("No walking route was returned for this destination.");
      if (routeRef.current) routeRef.current.remove();
      routeRef.current = L.geoJSON(route.geometry, { style: { color: "#df5b70", weight: 5, opacity: .88 } }).addTo(mapRef.current);
      mapRef.current.fitBounds(routeRef.current.getBounds(), { padding: [28, 28] });
      setRouteInfo({ distance: (route.distance / 1000).toFixed(1), minutes: Math.max(1, Math.round(route.duration / 60)) });
    } catch (e) {
      setError(e.name === "AbortError" ? "The route service took too long. Try again, or open the walking directions in Google Maps." : (e.message || "Could not calculate a route."));
    } finally {
      clearTimeout(timeoutId);
      setRouteLoading(false);
    }
  };

  const loadDemoPlaces = () => {
    if (!hasLocation) return;
    const samples = [
      { id: "demo-a", name: "Sample public place A", category: "Illustrative public place", kind: "other", dLat: 0.0018, dLng: 0.0012 },
      { id: "demo-b", name: "Sample health facility B", category: "Illustrative health facility", kind: "health", dLat: -0.0022, dLng: 0.0015 },
      { id: "demo-c", name: "Sample pharmacy C", category: "Illustrative pharmacy", kind: "pharmacy", dLat: 0.0011, dLng: -0.0024 },
      { id: "demo-d", name: "Sample staffed shop D", category: "Illustrative shop", kind: "shop", dLat: -0.0028, dLng: -0.0017 }
    ];
    const generated = samples.map(item => {
      const lat = location.lat + item.dLat;
      const lng = location.lng + item.dLng;
      return { id: item.id, name: item.name, category: item.category, kind: item.kind, lat, lng, distance: L.latLng(location.lat, location.lng).distanceTo([lat, lng]), source: "demo", tags: {} };
    });
    setPlaces(generated);
    setFilter("all");
    setSelected(null);
    clearRoute();
    setError("DEMO DATA: These are simulated markers placed near your current map center. They are NOT real venues, verified facilities, or navigation destinations.");
  };

  const retryLive = () => {
    setPlaces([]);
    setError("");
    if (hasLocation) setSearchCenter({ lat: location.lat, lng: location.lng });
    setRetryCount(v => v + 1);
  };

  const distanceText = value => value < 1000 ? `${Math.round(value)} m` : `${(value / 1000).toFixed(1)} km`;
  const mapClass = compact ? "saathi-map compact-map" : large ? "saathi-map large-map" : "saathi-map";
  const isDemo = places.some(p => p.source === "demo");
  const directionsUrl = selected && hasLocation
    ? `https://www.google.com/maps/dir/?api=1&origin=${location.lat},${location.lng}&destination=${selected.lat},${selected.lng}&travelmode=walking` : null;

  return <div className={`map-view ${compact ? "map-view-compact" : ""}`}>
    <div className={mapClass} ref={mapNode}/>
    {!hasLocation && <div className="map-overlay-prompt"><div className="map-prompt-icon"><MapPin size={21}/></div><b>Your location is not available</b><span>Tap below and allow browser location access to search around you. The map currently shows a general India view, not your position.</span><button className="btn btn-primary btn-sm" onClick={onLocate}><LocateFixed size={14}/> Get my location</button></div>}
    {hasLocation && <div className="map-attribution-note"><span className="map-live-dot"/> Location fix · ±{location.accuracy || "—"} m</div>}
    {hasLocation && <button className="map-recenter" onClick={recenter} title="Re-centre on my location" aria-label="Re-centre on my location"><LocateFixed size={16}/></button>}
    {tileNotice && <div className="map-notice" role="status">{tileNotice}</div>}
    {hasLocation && Number(location.accuracy) > 1000 && !compact && <div className="map-notice map-notice-warn" role="status">Your position is only accurate to about {(Number(location.accuracy) / 1000).toFixed(1)} km. This is normal on a laptop without GPS, so nearby results are approximate. For a precise fix use a phone with GPS.</div>}
    {!compact && <div className="nearby-results">
      <div className="nearby-results-head"><div><div className="eyebrow">MAP DATA RESULTS</div><b>{loading ? "Searching nearby…" : `${visiblePlaces.length} mapped place${visiblePlaces.length === 1 ? "" : "s"} shown${filter !== "all" ? ` (of ${places.length})` : ""}`}</b></div><span className="map-data-tag">{isDemo ? "SIMULATED DEMO DATA" : "OpenStreetMap · LIVE"}</span></div>
      <div className="map-controls">
        <div className="map-filter-chips" role="group" aria-label="Filter places">{FILTERS.map(f => <button key={f.id} className={`map-filter-chip ${filter === f.id ? "active" : ""}`} onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}>{f.label}</button>)}</div>
        <label className="map-radius">Search radius<select value={radius} onChange={e => setRadius(Number(e.target.value))} disabled={isDemo}>{RADIUS_OPTIONS.map(o => <option key={o.m} value={o.m}>{o.label}</option>)}</select></label>
      </div>
      {error && <div className="map-error"><AlertCircle size={14}/><span>{error}</span>{isDemo ? <button className="btn btn-outline btn-sm" onClick={retryLive}>Try live data</button> : <div className="map-error-actions"><button className="btn btn-outline btn-sm" onClick={retryLive}>Retry live</button><button className="btn btn-primary btn-sm" onClick={loadDemoPlaces} disabled={!hasLocation}>Use demo data</button></div>}</div>}
      {visiblePlaces.length > 0 && <div className="place-list">{visiblePlaces.slice(0, 12).map(place => <button className={`place-row ${selected?.id === place.id ? "place-selected" : ""}`} key={place.id} onClick={() => choosePlace(place)}><span className={`place-kind ${place.kind}`}><MapPin size={15}/></span><span className="place-row-info"><b>{place.name}</b><small>{place.category}</small></span><span className="place-distance">{distanceText(place.distance)}</span></button>)}</div>}
      {selected && <div className="selected-place"><div><b>{selected.name}</b><span>{selected.category} · {distanceText(selected.distance)} away{selected.source === "demo" ? " · simulated" : ""}</span></div>{selected.source === "demo" ? <span className="demo-only-label">Route disabled for sample data</span> : <div className="selected-place-actions"><button className="btn btn-primary btn-sm" onClick={showRoute} disabled={routeLoading}>{routeLoading ? "Finding route…" : "Show walking route"} <Navigation size={14}/></button>{directionsUrl && <a className="btn btn-outline btn-sm" href={directionsUrl} target="_blank" rel="noreferrer">Google Maps <ExternalLink size={13}/></a>}</div>}</div>}
      {routeInfo && <div className="route-result"><CheckCircle2 size={15}/><span>Route preview: <b>{routeInfo.distance} km</b> · approx. <b>{routeInfo.minutes} min</b> walking</span></div>}
      <p className="map-footnote">Live place data may be incomplete. Demo markers are fictional and cannot be used for navigation. Opening hours, staffing and safety are not verified.</p>
    </div>}
  </div>;
}
