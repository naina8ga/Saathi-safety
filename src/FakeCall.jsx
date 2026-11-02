import React, { useEffect, useState } from "react";
import { MicOff, Mic, Phone, PhoneOff, User, Volume2 } from "lucide-react";
import { formatCountdown } from "./lib/safety";

// Browsers only allow sound after a user gesture, so the app calls primeAudio() from the
// "Schedule call" tap. The ring itself can then start later, when the timer fires.
let audioCtx = null;
export function primeAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.();
  } catch {}
}

function ringOnce() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  [0, 0.45].forEach((offset) => {
    [440, 480].forEach((freq) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t + offset);
      gain.gain.linearRampToValueAtTime(0.09, t + offset + 0.03);
      gain.gain.setValueAtTime(0.09, t + offset + 0.32);
      gain.gain.linearRampToValueAtTime(0, t + offset + 0.38);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t + offset);
      osc.stop(t + offset + 0.4);
    });
  });
}

// A simulated incoming call screen. Nothing is dialled and nobody is contacted.
export default function FakeCall({ call, ringtone, onAnswer, onEnd }) {
  const [now, setNow] = useState(Date.now());
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const ringing = call.stage === "ringing";

  useEffect(() => {
    if (!ringing) return;
    const buzz = () => navigator.vibrate?.([700, 350, 700]);
    if (ringtone) ringOnce();
    buzz();
    const timer = setInterval(() => { if (ringtone) ringOnce(); buzz(); }, 2400);
    return () => { clearInterval(timer); navigator.vibrate?.(0); };
  }, [ringing, ringtone]);

  useEffect(() => {
    if (ringing) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ringing]);

  const initial = (call.callerName || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="fakecall-screen" role="alertdialog" aria-modal="true" aria-label={ringing ? `Incoming call from ${call.callerName}` : `Call with ${call.callerName}`}>
      <div className="fakecall-top">
        <span className="fakecall-status">{ringing ? "incoming call" : formatCountdown(now - (call.connectedAt || now))}</span>
        <div className="fakecall-avatar" aria-hidden="true">{initial || <User size={40} />}</div>
        <h2>{call.callerName}</h2>
        <p>mobile</p>
      </div>
      {ringing ? (
        <div className="fakecall-actions">
          <button className="fakecall-btn decline" onClick={onEnd} aria-label="Decline call"><PhoneOff size={28} /><span>Decline</span></button>
          <button className="fakecall-btn accept" onClick={onAnswer} aria-label="Answer call"><Phone size={28} /><span>Accept</span></button>
        </div>
      ) : (
        <div className="fakecall-connected">
          <div className="fakecall-toggles">
            <button className={`fakecall-toggle ${muted ? "on" : ""}`} onClick={() => setMuted((v) => !v)} aria-pressed={muted}>{muted ? <MicOff size={22} /> : <Mic size={22} />}<span>Mute</span></button>
            <button className={`fakecall-toggle ${speaker ? "on" : ""}`} onClick={() => setSpeaker((v) => !v)} aria-pressed={speaker}><Volume2 size={22} /><span>Speaker</span></button>
          </div>
          <button className="fakecall-btn decline" onClick={onEnd} aria-label="End call"><PhoneOff size={28} /><span>End</span></button>
        </div>
      )}
    </div>
  );
}
