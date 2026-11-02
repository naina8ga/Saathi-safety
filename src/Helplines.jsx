import React, { useMemo, useState } from "react";
import { Phone, Copy, Search, Siren, Shield, Heart, Flame, Baby, Users } from "lucide-react";

// India national helplines. Numbers are static reference data; Saathi does not place calls itself.
const LINES = [
  { num: "112", name: "National Emergency", note: "Police, fire and ambulance in one number.", icon: Siren, main: true },
  { num: "1091", name: "Women Helpline", note: "Help for women facing harassment or danger.", icon: Shield },
  { num: "181", name: "Women Helpline (Domestic)", note: "Support and guidance for women in distress.", icon: Users },
  { num: "100", name: "Police", note: "Direct line to local police control room.", icon: Siren },
  { num: "102", name: "Ambulance", note: "Medical emergency and patient transport.", icon: Heart },
  { num: "101", name: "Fire", note: "Fire and rescue services.", icon: Flame },
  { num: "1098", name: "Childline", note: "Help for children in need of care or protection.", icon: Baby },
  { num: "1930", name: "Cyber Crime", note: "Report online fraud and financial cyber crime.", icon: Shield }
];

export default function Helplines({ onCopied }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => LINES.filter(l => (l.name + l.num + l.note).toLowerCase().includes(q.trim().toLowerCase())), [q]);
  const copy = async (n) => {
    try { await navigator.clipboard.writeText(n); onCopied?.(`Copied ${n}`); } catch { onCopied?.(`Number: ${n}`); }
  };
  return (
    <>
      <div style={{ position: "relative" }}>
        <input className="text-field hl-search" placeholder="Search helplines (e.g. women, fire, 112)" value={q} onChange={e => setQ(e.target.value)} aria-label="Search helplines" />
        <Search size={18} style={{ position: "absolute", right: 14, top: 14, color: "#9aa6b2", pointerEvents: "none" }} />
      </div>
      <div className="hl-grid">
        {shown.map(l => { const I = l.icon; return (
          <article key={l.num} className={`hl-card ${l.main ? "hl-primary" : ""}`}>
            <div className="hl-top"><span className="quick-icon rose-soft"><I size={20} /></span><span className="hl-num">{l.num}</span></div>
            <h3>{l.name}</h3><p>{l.note}</p>
            <div className="hl-actions">
              <a className="btn btn-danger" href={`tel:${l.num}`}><Phone size={16} /> Call</a>
              <button className="btn btn-outline" onClick={() => copy(l.num)}><Copy size={15} /> Copy</button>
            </div>
          </article>); })}
        {!shown.length && <p className="muted-small">No helpline matches “{q}”.</p>}
      </div>
    </>
  );
}
