import { useState, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";

type Sport = "run" | "cyc" | "clm" | "swm" | "tri";
type ViewMode = "grid" | "map" | "list";
type ModalId =
  | "london-half" | "victoria-parkrun" | "hackney-half"
  | "richmond-sportive" | "arch-open" | "east-end-10k"
  | "tooting-swim" | "generic";
type RsvpChoice = "going" | "maybe" | "cant";

interface CardDef {
  id: string;
  day: string; mon: string;
  title: string; loc: string;
  sport: Sport; ai: number;
  dateBg: string; dayColor: string; monColor: string;
  tags: Array<{ label: string; cls: string }>;
  socialAvs: Array<{ bg: string; fg: string; label: string }>;
  overflow?: string;
  socialText: string;
  modalId: ModalId;
}

const CARDS: CardDef[] = [
  { id: "victoria-parkrun", day: "19", mon: "Apr", sport: "run", ai: 91,
    title: "Victoria Park Parkrun — Club Takeover", loc: "📍 Victoria Park, London · 0.4 mi",
    dateBg: "#FFF7ED", dayColor: "#9A3412", monColor: "#C2410C",
    tags: [{ label: "🏃 Running", cls: "run" }, { label: "Free", cls: "free" }, { label: "22 clubmates going", cls: "going" }],
    socialAvs: [{ bg: "#FEF9C3", fg: "#854D0E", label: "SL" }, { bg: "#E0F2FE", fg: "#0369A1", label: "AL" }],
    overflow: "+20", socialText: "going", modalId: "victoria-parkrun" },
  { id: "richmond-sportive", day: "26", mon: "Apr", sport: "cyc", ai: 88,
    title: "Richmond Park Spring Sportive", loc: "📍 Richmond, London · 8.2 mi",
    dateBg: "#EFF6FF", dayColor: "#1E40AF", monColor: "#2563EB",
    tags: [{ label: "🚴 Cycling", cls: "cyc" }, { label: "80km · £28", cls: "gray" }, { label: "✦ 88% match", cls: "ai" }],
    socialAvs: [], socialText: "No clubmates yet — be first!", modalId: "richmond-sportive" },
  { id: "hackney-half", day: "3", mon: "May", sport: "run", ai: 91,
    title: "Hackney Half Marathon 2026", loc: "📍 Hackney, London · 1.1 mi",
    dateBg: "#FFF7ED", dayColor: "#9A3412", monColor: "#C2410C",
    tags: [{ label: "🏃 Running", cls: "run" }, { label: "13.1 mi · £38", cls: "gray" }, { label: "✦ 91% match", cls: "ai" }, { label: "8 clubmates", cls: "going" }],
    socialAvs: [{ bg: "#FCE7F3", fg: "#9D174D", label: "YT" }],
    overflow: "+7", socialText: "going", modalId: "hackney-half" },
  { id: "arch-open", day: "10", mon: "May", sport: "clm", ai: 72,
    title: "The Arch Bouldering Open", loc: "📍 Bermondsey, London · 2.8 mi",
    dateBg: "#F5F3FF", dayColor: "#5B21B6", monColor: "#7C3AED",
    tags: [{ label: "🧗 Climbing", cls: "clm" }, { label: "V4–V7", cls: "gray" }, { label: "Free entry", cls: "free" }],
    socialAvs: [], socialText: "No clubmates yet", modalId: "arch-open" },
  { id: "east-end-10k", day: "17", mon: "May", sport: "run", ai: 76,
    title: "East End 10K — Spring Series", loc: "📍 Victoria Park, London · 0.4 mi",
    dateBg: "#FFF7ED", dayColor: "#9A3412", monColor: "#C2410C",
    tags: [{ label: "🏃 Running", cls: "run" }, { label: "10K · £22", cls: "gray" }, { label: "✦ 76% match", cls: "ai" }, { label: "4 pending", cls: "pend" }],
    socialAvs: [{ bg: "#FBEAF0", fg: "#72243E", label: "PR" }],
    overflow: "+3", socialText: "pending RSVP", modalId: "east-end-10k" },
  { id: "tooting-swim", day: "24", mon: "May", sport: "swm", ai: 60,
    title: "Tooting Bec Lido Open Water Swim", loc: "📍 Tooting, London · 6.4 mi",
    dateBg: "#F0FDFA", dayColor: "#134E4A", monColor: "#0F766E",
    tags: [{ label: "🏊 Swimming", cls: "swm" }, { label: "Free", cls: "free" }, { label: "All levels", cls: "gray" }],
    socialAvs: [], socialText: "Be the first from your club!", modalId: "tooting-swim" },
  { id: "greenwich-5k", day: "7", mon: "Jun", sport: "run", ai: 85,
    title: "Greenwich Park 5K Fun Run", loc: "📍 Greenwich, London · 4.2 mi",
    dateBg: "#FFF7ED", dayColor: "#9A3412", monColor: "#C2410C",
    tags: [{ label: "🏃 Running", cls: "run" }, { label: "Free", cls: "free" }, { label: "✦ 85% match", cls: "ai" }],
    socialAvs: [], socialText: "No clubmates yet", modalId: "generic" },
  { id: "london-tri", day: "15", mon: "Jun", sport: "tri", ai: 55,
    title: "London Sprint Triathlon 2026", loc: "📍 Docklands, London · 5.8 mi",
    dateBg: "#FBEAF0", dayColor: "#72243E", monColor: "#9D174D",
    tags: [{ label: "🔱 Triathlon", cls: "tri" }, { label: "Sprint · £65", cls: "gray" }, { label: "3 clubmates interested", cls: "gray" }],
    socialAvs: [{ bg: "#FCE7F3", fg: "#9D174D", label: "YT" }],
    overflow: "+2", socialText: "interested", modalId: "generic" },
];

const MORE_CARDS: CardDef[] = [
  { id: "regents-5k", day: "21", mon: "Jun", sport: "run", ai: 82,
    title: "Regent's Park 5K Series", loc: "📍 Regent's Park · 0.9 mi",
    dateBg: "#FFF7ED", dayColor: "#9A3412", monColor: "#C2410C",
    tags: [{ label: "🏃 Running", cls: "run" }, { label: "Free", cls: "free" }],
    socialAvs: [], socialText: "No clubmates yet", modalId: "generic" },
  { id: "crystal-tri", day: "28", mon: "Jun", sport: "tri", ai: 58,
    title: "Crystal Palace Triathlon", loc: "📍 Crystal Palace · 7.3 mi",
    dateBg: "#FBEAF0", dayColor: "#72243E", monColor: "#9D174D",
    tags: [{ label: "🔱 Triathlon", cls: "tri" }, { label: "£75", cls: "gray" }],
    socialAvs: [], socialText: "2 interested", modalId: "generic" },
];

const SPORT_LABELS: [string, string][] = [
  ["all", "All sports"], ["run", "🏃 Running"], ["cyc", "🚴 Cycling"],
  ["clm", "🧗 Climbing"], ["swm", "🏊 Swimming"], ["tri", "🔱 Triathlon"],
];

const TYPE_OPTS = ["5K", "10K", "Half marathon", "Marathon", "Sportive", "Fun run", "Free only"];

const MAP_PINS = [
  { left: "32%", top: "40%", label: "London Half · Apr 13",  bg: "var(--ev-yellow)",      color: "var(--ev-gray-900)", border: "var(--ev-yellow-dark)", toast: "London Half Marathon — Apr 13" },
  { left: "55%", top: "30%", label: "Parkrun · Apr 19",      bg: "var(--ev-green-light)",  color: "#166534",           border: "#86EFAC",               toast: "Victoria Park Parkrun — Apr 19" },
  { left: "48%", top: "58%", label: "Hackney Half · May 3",  bg: "var(--ev-orange-light)", color: "#9A3412",           border: "#FDBA74",               toast: "Hackney Half — May 3" },
  { left: "22%", top: "62%", label: "Richmond Sportive",     bg: "var(--ev-blue-light)",   color: "#1E40AF",           border: "#93C5FD",               toast: "Richmond Sportive — Apr 26" },
  { left: "65%", top: "70%", label: "Arch Open · May 10",    bg: "var(--ev-purple-light)", color: "#5B21B6",           border: "#C4B5FD",               toast: "The Arch Bouldering — May 10" },
  { left: "70%", top: "48%", label: "East End 10K",          bg: "var(--ev-orange-light)", color: "#9A3412",           border: "#FDBA74",               toast: "East End 10K — May 17" },
  { left: "42%", top: "78%", label: "Lido Swim · May 24",    bg: "var(--ev-teal-light)",   color: "#134E4A",           border: "#5EEAD4",               toast: "Tooting Lido Swim — May 24" },
];

interface ModalHeader {
  day: string; mon: string; title: string; meta: string;
  dateBg: string; dayColor: string; monColor: string; hasBorder?: boolean;
  tags: Array<{ label: string; cls: string }>;
}

const MODAL_HEADERS: Record<ModalId, ModalHeader> = {
  "london-half":       { day: "13", mon: "Apr", title: "London Half Marathon 2026",            meta: "📍 Blackheath, London · 13.1 miles · £45 entry · Gun start 7:00 AM · 8,000 runners", dateBg: "var(--ev-yellow)", dayColor: "var(--ev-gray-900)", monColor: "var(--ev-gray-700)", hasBorder: true, tags: [{ label: "🏃 Running", cls: "run" }, { label: "34 clubmates going", cls: "going" }, { label: "✦ 94% match", cls: "ai" }] },
  "victoria-parkrun":  { day: "19", mon: "Apr", title: "Victoria Park Parkrun — Club Takeover", meta: "📍 Victoria Park, London · 5K · Free · 9:00 AM",                                    dateBg: "#FFF7ED",          dayColor: "#9A3412",            monColor: "#C2410C",                         tags: [{ label: "🏃 Running", cls: "run" }, { label: "Free", cls: "free" }, { label: "22 clubmates going", cls: "going" }] },
  "hackney-half":      { day: "3",  mon: "May", title: "Hackney Half Marathon 2026",            meta: "📍 Hackney, London · 13.1 miles · £38 · 7:30 AM start",                              dateBg: "#FFF7ED",          dayColor: "#9A3412",            monColor: "#C2410C",                         tags: [{ label: "🏃 Running", cls: "run" }, { label: "✦ 91% match", cls: "ai" }, { label: "RSVP deadline: May 1", cls: "pend" }] },
  "richmond-sportive": { day: "26", mon: "Apr", title: "Richmond Park Spring Sportive",         meta: "📍 Richmond, London · 80km · £28 · 8:00 AM start",                                   dateBg: "#EFF6FF",          dayColor: "#1E40AF",            monColor: "#2563EB",                         tags: [{ label: "🚴 Cycling", cls: "cyc" }, { label: "✦ 88% match", cls: "ai" }] },
  "arch-open":         { day: "10", mon: "May", title: "The Arch Bouldering Open",              meta: "📍 Bermondsey, London · Free entry · All day · V4–V7 categories",                    dateBg: "#F5F3FF",          dayColor: "#5B21B6",            monColor: "#7C3AED",                         tags: [{ label: "🧗 Climbing", cls: "clm" }, { label: "Free", cls: "free" }, { label: "V4–V7", cls: "gray" }] },
  "east-end-10k":      { day: "17", mon: "May", title: "East End 10K — Spring Series",          meta: "📍 Victoria Park, London · 10K · £22 · 10:00 AM",                                    dateBg: "#FFF7ED",          dayColor: "#9A3412",            monColor: "#C2410C",                         tags: [{ label: "🏃 Running", cls: "run" }, { label: "✦ 76% match", cls: "ai" }, { label: "4 clubmates pending", cls: "pend" }] },
  "tooting-swim":      { day: "24", mon: "May", title: "Tooting Bec Lido Open Water Swim",      meta: "📍 Tooting, London · Free · Open water · All levels",                                dateBg: "#F0FDFA",          dayColor: "#134E4A",            monColor: "#0F766E",                         tags: [{ label: "🏊 Swimming", cls: "swm" }, { label: "Free", cls: "free" }, { label: "All levels", cls: "gray" }] },
  "generic":           { day: "7",  mon: "Jun", title: "Upcoming Event",                        meta: "📍 London · More details available",                                                  dateBg: "#FFF7ED",          dayColor: "#9A3412",            monColor: "#C2410C",                         tags: [{ label: "🏃 Running", cls: "run" }] },
};

export default function Events() {
  const [, setLocation] = useLocation();
  const { logout } = useAuth();

  const [sportActive, setSportActive] = useState<Set<string>>(new Set(["all", "run", "cyc"]));
  const [when, setWhen] = useState<"this-month" | "next-3" | "any">("this-month");
  const [distance, setDistance] = useState<"10" | "25" | "50" | "any">("10");
  const [typeActive, setTypeActive] = useState<Set<string>>(new Set(["Half marathon"]));
  const [aiOnly, setAiOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("grid");

  const [featGoing, setFeatGoing] = useState(false);
  const [cardRsvp, setCardRsvp] = useState<Record<string, boolean>>({ "victoria-parkrun": true });
  const [modalRsvp, setModalRsvp] = useState<Record<string, RsvpChoice | null>>({});
  const [modal, setModal] = useState<{ cardId: string; modalId: ModalId } | null>(null);
  const [loadedMore, setLoadedMore] = useState(false);

  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg); setToastVisible(true);
    toastTimer.current = setTimeout(() => setToastVisible(false), 2800);
  }, []);

  const toggleSport = (val: string) => {
    setSportActive(prev => {
      const next = new Set(prev);
      if (val === "all") return next.has("all") ? new Set<string>() : new Set(["all", "run", "cyc", "clm", "swm", "tri"]);
      if (next.has(val)) { next.delete(val); next.delete("all"); }
      else { next.add(val); if (["run","cyc","clm","swm","tri"].every(s => next.has(s))) next.add("all"); }
      return next;
    });
  };

  const toggleType = (val: string) => {
    setTypeActive(prev => { const n = new Set(prev); if (n.has(val)) n.delete(val); else n.add(val); return n; });
  };

  const setViewMode = (v: ViewMode) => {
    setView(v);
    showToast(v === "grid" ? "Grid view" : v === "map" ? "Map view — click pins to preview events" : "List view");
  };

  const cardVisible = useCallback((card: CardDef): boolean => {
    const sportOk = sportActive.has("all") || sportActive.has(card.sport);
    const aiOk = !aiOnly || card.ai >= 80;
    const searchOk = !search || (card.title + " " + card.loc + " " + card.tags.map(t => t.label).join(" ")).toLowerCase().includes(search.toLowerCase());
    return sportOk && aiOk && searchOk;
  }, [sportActive, aiOnly, search]);

  const allCards = useMemo(() => [...CARDS, ...(loadedMore ? MORE_CARDS : [])], [loadedMore]);
  const visibleCards = useMemo(() => allCards.filter(cardVisible), [allCards, cardVisible]);

  const quickRsvp = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCardRsvp(prev => ({ ...prev, [id]: true }));
    showToast("✓ RSVP confirmed — added to your events!");
  };

  const doModalRsvp = (choice: RsvpChoice) => {
    if (!modal) return;
    setModalRsvp(prev => ({ ...prev, [modal.modalId]: choice }));
    const msg = choice === "going"
      ? (modal.modalId === "london-half" ? "✓ Going! Coach Rachel notified" : "✓ RSVP confirmed!")
      : choice === "maybe" ? "Maybe recorded"
      : (modal.modalId === "london-half" ? "Declined — Rachel notified" : "Declined");
    showToast(msg);
  };

  const closeModal = () => setModal(null);

  const renderTags = (tags: Array<{ label: string; cls: string }>) =>
    tags.map((t, i) => <span key={i} className={`ev-tag ev-t-${t.cls}`}>{t.label}</span>);

  const renderCard = (card: CardDef, idx: number) => {
    const isGoing = !!cardRsvp[card.id];
    const noBorderRight = view === "list" || idx % 2 === 1 || idx === visibleCards.length - 1;
    return (
      <div key={card.id} className={`ev-ev-card${noBorderRight ? " no-right-border" : ""}`}
        style={{ animationDelay: `${idx * 0.05}s` }}
        onClick={() => setModal({ cardId: card.id, modalId: card.modalId })}>
        <div className="ev-ev-card-top">
          <div className="ev-ev-date-box" style={{ background: card.dateBg }}>
            <div className="ev-edb-day" style={{ color: card.dayColor }}>{card.day}</div>
            <div className="ev-edb-mon" style={{ color: card.monColor }}>{card.mon}</div>
          </div>
          <div>
            <div className="ev-ev-title">{card.title}</div>
            <div className="ev-ev-loc">{card.loc}</div>
          </div>
        </div>
        <div className="ev-ev-tags">{renderTags(card.tags)}</div>
        <div className="ev-ev-footer">
          <div className="ev-ev-social">
            {card.socialAvs.length > 0 ? (
              <>
                {card.socialAvs.map((av, i) => <div key={i} className="ev-ev-av" style={{ background: av.bg, color: av.fg }}>{av.label}</div>)}
                {card.overflow && <div className="ev-ev-av" style={{ background: "var(--ev-gray-100)", color: "var(--ev-gray-500)", fontSize: 6 }}>{card.overflow}</div>}
                <span className="ev-ev-social-text">{card.socialText}</span>
              </>
            ) : (
              <><div className="ev-no-dot" /><span className="ev-ev-social-text">{card.socialText}</span></>
            )}
          </div>
          {isGoing
            ? <button className="ev-rsvp-btn going" onClick={e => e.stopPropagation()}>✓ Going</button>
            : <button className="ev-rsvp-btn default" onClick={e => quickRsvp(card.id, e)}>RSVP</button>}
        </div>
      </div>
    );
  };

  const renderModalBody = () => {
    if (!modal) return null;
    const cur = modalRsvp[modal.modalId] ?? null;

    const RsvpSection = ({ label }: { label: string }) => (
      <div className="ev-rsvp-section">
        <div className="ev-rs-label">{label}</div>
        <div className="ev-rs-buttons">
          <button className={`ev-btn${cur === "going" ? " ev-btn-green" : ""}`} onClick={() => doModalRsvp("going")}>✓ Going</button>
          <button className={`ev-btn${cur === "maybe" ? " ev-btn-primary" : ""}`} onClick={() => doModalRsvp("maybe")}>Maybe</button>
          <button className="ev-btn" onClick={() => doModalRsvp("cant")}>Can't make it</button>
        </div>
      </div>
    );

    const DetailGrid = ({ rows }: { rows: [string, string, string?][] }) => (
      <div className="ev-detail-grid">
        {rows.map(([l, v, color]) => (
          <div key={l} className="ev-detail-item">
            <div className="ev-detail-label">{l}</div>
            <div className="ev-detail-val" style={color ? { color } : undefined}>{v}</div>
          </div>
        ))}
      </div>
    );

    const AiSection = ({ text }: { text: string }) => (
      <div className="ev-ai-section">
        <div className="ev-ai-s-label">✦ AI coach insight</div>
        <div className="ev-ai-s-text" dangerouslySetInnerHTML={{ __html: text }} />
      </div>
    );

    switch (modal.modalId) {
      case "london-half": return (
        <>
          <DetailGrid rows={[["Distance","13.1 miles"],["Start time","7:00 AM"],["Entry fee","£45"],["RSVP deadline","Apr 6 · 8 days"],["Field size","8,000 runners"],["Your AI match","94% ✦","var(--ev-green)"]]} />
          <div className="ev-coach-note">
            <div className="ev-cn-label">📣 Coach Rachel's note</div>
            <div className="ev-cn-text">Meet at the start village at 6:30 AM in your club vest. Use group booking code <strong>HRC2026</strong> for the club rate. We're aiming for a group photo at the finish line — bring your best race face!</div>
          </div>
          <div className="ev-attendees-row">
            <div className="ev-clubmate-avs">
              {[["SL","#FEF9C3","#854D0E"],["YT","#FCE7F3","#9D174D"],["AL","#E0F2FE","#0369A1"],["PR","#FBEAF0","#72243E"]].map(([l,b,c]) => (
                <div key={l} className="ev-cm-av" style={{ background: b, color: c }}>{l}</div>
              ))}
              <div className="ev-cm-av" style={{ background: "var(--ev-gray-100)", color: "var(--ev-gray-500)", fontSize: 7 }}>+30</div>
            </div>
            <div style={{ fontSize: 12, color: "var(--ev-gray-600)" }}><strong style={{ color: "var(--ev-gray-900)" }}>34 Hackney RC members going</strong> · 8 still pending RSVP</div>
          </div>
          <AiSection text="Based on your current 1:54 HM PB and 62km/week training, your AI coach projects a finish time of <strong>1:50–1:52</strong> at current form — a realistic PB. Your training load needs to stay consistent for 3 more weeks. Consider tapering the week before the race." />
          <RsvpSection label="Your RSVP" />
        </>
      );
      case "victoria-parkrun": return (
        <>
          <DetailGrid rows={[["Distance","5 km"],["Start time","9:00 AM"],["Entry fee","Free"],["Location","0.4 mi away"]]} />
          <div className="ev-coach-note">
            <div className="ev-cn-label">📣 Coach Rachel's note</div>
            <div className="ev-cn-text">No registration needed — just show up in your club vest. We'll do a group photo at the finish. Great way to meet new Hackney RC members if you just joined!</div>
          </div>
          <AiSection text="This is a great opportunity to log a controlled 5K effort ahead of your London Half taper. The AI coach recommends running this at easy–moderate pace (zone 2–3) rather than racing it, to preserve your legs for the half marathon two weeks later." />
        </>
      );
      case "hackney-half": return (
        <>
          <div className="ev-detail-grid">
            {[["Distance","13.1 miles"],["Start time","7:30 AM"],["Entry fee","£38"],["Clubmates going","8"]].map(([l,v]) => (
              <div key={l} className="ev-detail-item"><div className="ev-detail-label">{l}</div><div className="ev-detail-val">{v}</div></div>
            ))}
            <div className="ev-detail-item"><div className="ev-detail-label">RSVP deadline</div><div className="ev-detail-val" style={{ color: "var(--ev-orange)" }}>May 1 · 8 days!</div></div>
            <div className="ev-detail-item"><div className="ev-detail-label">AI match</div><div className="ev-detail-val" style={{ color: "var(--ev-green)" }}>91% ✦</div></div>
          </div>
          <AiSection text="Your 91% match means this event suits your current fitness level well. Running Hackney Half 3 weeks after London gives a good recovery window — your AI coach can generate a tailored training plan between both events if you register for both." />
          <RsvpSection label="Your RSVP · deadline in 8 days" />
        </>
      );
      case "richmond-sportive": return (
        <>
          <div className="ev-detail-grid">
            {[["Distance","80 km"],["Start time","8:00 AM"],["Entry fee","£28"],["Elevation","~1,200 m"],["Location","8.2 mi away"]].map(([l,v]) => (
              <div key={l} className="ev-detail-item"><div className="ev-detail-label">{l}</div><div className="ev-detail-val">{v}</div></div>
            ))}
            <div className="ev-detail-item"><div className="ev-detail-label">AI match</div><div className="ev-detail-val" style={{ color: "var(--ev-green)" }}>88% ✦</div></div>
          </div>
          <AiSection text="At 241W FTP and recent 88km long rides, this sportive is well within your capability. Your AI coach suggests treating this as a zone 2–3 endurance effort rather than a race — ideal preparation for building your cycling base this spring." />
        </>
      );
      case "arch-open": return (
        <>
          <DetailGrid rows={[["Format","Bouldering"],["Entry","Free"],["Categories","V4, V5, V6, V7"],["Location","2.8 mi away"]]} />
          <AiSection text="Based on your recent V5 sends, you're well placed for the V5 category and could attempt V6 if you continue projecting over the next few weeks. This would be a great milestone to track in your climbing progression on Arenas." />
        </>
      );
      case "east-end-10k": return (
        <>
          <DetailGrid rows={[["Distance","10 km"],["Start time","10:00 AM"],["Entry fee","£22"],["Location","0.4 mi away"]]} />
          <AiSection text="Your 76% match reflects that this 10K comes 2 weeks after Hackney Half — an aggressive double. Your AI coach recommends treating it as a supported tempo run rather than a race if you're competing in both events." />
        </>
      );
      case "tooting-swim": return (
        <>
          <DetailGrid rows={[["Format","Open water"],["Entry","Free"],["Location","6.4 mi away"],["Level","All welcome"]]} />
          <AiSection text="You'd be the first Hackney RC member to register for this event — a great opportunity to introduce a cross-training discipline. Open water swimming is excellent low-impact recovery training for runners." />
        </>
      );
      default: return (
        <AiSection text="Register and we'll generate a personalised match score and training plan for this event based on your current fitness data." />
      );
    }
  };

  const mh = modal ? MODAL_HEADERS[modal.modalId] : null;
  const hasInlineRsvp = modal?.modalId === "london-half" || modal?.modalId === "hackney-half";

  return (
    <div className="ev-app">
      <div className={`ev-toast${toastVisible ? " show" : ""}`}>{toast}</div>

      {/* ── TOPBAR ── */}
      <header className="ev-topbar">
        <div className="ev-topbar-logo">
          <div className="ev-logo-icon">🏟</div>
          <span className="ev-logo-text">Arenas</span>
        </div>
        <div className="ev-topbar-center">
          <div className="ev-topbar-search">
            <span style={{ color: "var(--ev-gray-400)", fontSize: 13 }}>🔍</span>
            <input type="text" placeholder="Search events, locations, distances…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="ev-topbar-live"><div className="ev-live-dot" />2,100 events live</div>
        </div>
        <div className="ev-topbar-actions">
          <div className="ev-icon-btn" onClick={() => showToast("Opening notifications…")}>🔔<div className="ev-notif-dot" /></div>
          <div className="ev-user-av" onClick={() => setLocation("/profile")}>JK</div>
        </div>
      </header>

      {/* ── LEFT SIDEBAR ── */}
      <aside className="ev-sidebar">
        <div className="ev-nav-label">My Arenas</div>
        <div className="ev-nav-item" onClick={() => setLocation("/feed")}><span className="ev-nav-icon">🏠</span> Feed</div>
        <div className="ev-nav-item" onClick={() => setLocation("/profile")}><span className="ev-nav-icon">👤</span> My profile</div>
        <div className="ev-nav-item active"><span className="ev-nav-icon">📅</span> Events</div>
        <div className="ev-nav-item" onClick={() => showToast("Opening leaderboards…")}><span className="ev-nav-icon">🏆</span> Leaderboards</div>
        <div className="ev-nav-item" onClick={() => showToast("Opening challenges…")}><span className="ev-nav-icon">⚡</span> Challenges <span className="ev-nav-badge">3</span></div>
        <div className="ev-nav-item" onClick={() => showToast("Opening athletes…")}><span className="ev-nav-icon">👥</span> Athletes</div>
        <div className="ev-nav-label">My clubs</div>
        <div className="ev-nav-item" onClick={() => showToast("Opening club…")}><span className="ev-nav-icon">🏃</span> Hackney RC <span className="ev-nav-badge ev-badge-red">2</span></div>
        <div className="ev-nav-label">Account</div>
        <div className="ev-nav-item" onClick={() => showToast("Opening settings…")}><span className="ev-nav-icon">⚙️</span> Settings</div>
        <div className="ev-nav-item" onClick={() => showToast("Opening billing…")}><span className="ev-nav-icon">💳</span> Pro plan</div>
        <div className="ev-sidebar-footer">
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--ev-yellow)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: "var(--ev-gray-900)", flexShrink: 0 }}>JK</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ev-gray-900)" }}>Jamie King</div>
            <div style={{ fontSize: 10, color: "var(--ev-gray-500)" }}>@jamiek · Pro</div>
          </div>
          <button style={{ marginLeft: "auto", padding: "4px 8px", fontSize: 11, borderRadius: 6, border: "var(--ev-border)", background: "white", color: "var(--ev-gray-600)", cursor: "pointer" }} onClick={() => { logout(); setLocation("/"); }}>Log out</button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="ev-main">

        {/* FILTER ZONE */}
        <div className="ev-filter-zone">
          <div className="ev-filter-row">
            <span className="ev-f-group-label">Sport</span>
            {SPORT_LABELS.map(([val, label]) => (
              <div key={val} className={`ev-f-pill${sportActive.has(val) ? " on" : ""}`} onClick={() => toggleSport(val)}>{label}</div>
            ))}
            <div className="ev-f-sep" />
            <span className="ev-f-group-label">When</span>
            {(["this-month","next-3","any"] as const).map((val, i) => (
              <div key={val} className={`ev-f-pill${when === val ? " on" : ""}`} onClick={() => setWhen(val)}>{["This month","Next 3 months","Any time"][i]}</div>
            ))}
          </div>
          <div className="ev-filter-row">
            <span className="ev-f-group-label">Within</span>
            {(["10","25","50","any"] as const).map((val, i) => (
              <div key={val} className={`ev-f-pill${distance === val ? " on" : ""}`} onClick={() => setDistance(val)}>{["10 miles","25 miles","50 miles","Anywhere"][i]}</div>
            ))}
            <div className="ev-f-sep" />
            <span className="ev-f-group-label">Type</span>
            {TYPE_OPTS.map(label => (
              <div key={label} className={`ev-f-pill${typeActive.has(label) ? " on" : ""}`} onClick={() => toggleType(label)}>{label}</div>
            ))}
            <div className="ev-f-sep" />
            <div className={`ev-f-pill ai-pill${aiOnly ? " on" : ""}`} onClick={() => setAiOnly(a => !a)}>✦ AI matched only</div>
            <div className="ev-f-right">
              <span className="ev-filter-count">{visibleCards.length} events</span>
              <div className="ev-view-toggle">
                <div className={`ev-vt-btn${view === "grid" ? " on" : ""}`} onClick={() => setViewMode("grid")}>⊞ Grid</div>
                <div className={`ev-vt-btn${view === "map"  ? " on" : ""}`} onClick={() => setViewMode("map")}>🗺 Map</div>
                <div className={`ev-vt-btn${view === "list" ? " on" : ""}`} onClick={() => setViewMode("list")}>☰ List</div>
              </div>
              <select className="ev-sort-select" onChange={e => showToast("Sorted: " + e.target.value)}>
                <option>Sort: By date</option>
                <option>Sort: Nearest first</option>
                <option>Sort: AI match score</option>
                <option>Sort: Clubmates going</option>
                <option>Sort: Price: low to high</option>
              </select>
            </div>
          </div>
        </div>

        {/* BODY GRID */}
        <div className="ev-body-grid">

          {/* EVENTS COLUMN */}
          <div className="ev-events-col">

            {/* Featured */}
            {view !== "map" && (
              <div className="ev-featured-wrap">
                <div className="ev-featured-label">✦ Top AI match for you · based on your current fitness and training history</div>
                <div className="ev-featured-card" onClick={() => setModal({ cardId: "london-half", modalId: "london-half" })}>
                  <div className="ev-feat-top">
                    <div className="ev-feat-date-box"><div className="ev-fdb-day">13</div><div className="ev-fdb-mon">Apr</div></div>
                    <div className="ev-feat-info">
                      <div className="ev-feat-rec-badge">✦ 94% fitness match · Recommended for you</div>
                      <div className="ev-feat-title">London Half Marathon 2026</div>
                      <div className="ev-feat-meta">📍 Blackheath, London · 0.8 miles away · 13.1 miles · £45 entry · 8,000 runners · Gun start 7:00 AM</div>
                      <div className="ev-feat-tags">
                        <span className="ev-tag ev-t-run">🏃 Running</span>
                        <span className="ev-tag ev-t-going">34 Hackney RC members going</span>
                        <span className="ev-tag ev-t-ai">✦ 94% match</span>
                        <span className="ev-tag ev-t-gray">8 days to RSVP</span>
                      </div>
                    </div>
                    <div className="ev-feat-actions">
                      <div className="ev-ai-match-score">
                        <div className="ev-ams-value">94<span style={{ fontSize: 14 }}>%</span></div>
                        <div className="ev-ams-bar"><div className="ev-ams-fill" style={{ width: "94%" }} /></div>
                        <div className="ev-ams-label">AI match</div>
                      </div>
                      {featGoing
                        ? <button className="ev-btn ev-btn-green ev-btn-full" disabled style={{ justifyContent: "center" }}>✓ You're going!</button>
                        : <button className="ev-btn ev-btn-yellow ev-btn-full" style={{ justifyContent: "center" }} onClick={e => { e.stopPropagation(); setFeatGoing(true); showToast("✓ RSVP confirmed for London Half Marathon — Coach Rachel notified!"); }}>✓ I'm going</button>}
                      <button className="ev-btn ev-btn-full" style={{ justifyContent: "center", fontSize: 12 }} onClick={e => { e.stopPropagation(); setModal({ cardId: "london-half", modalId: "london-half" }); }}>View details →</button>
                    </div>
                  </div>
                  <div className="ev-feat-bottom">
                    <div className="ev-clubmate-avs">
                      {[["SL","#FEF9C3","#854D0E"],["YT","#FCE7F3","#9D174D"],["AL","#E0F2FE","#0369A1"],["PR","#FBEAF0","#72243E"],["TR","#F5F3FF","#5B21B6"]].map(([l,b,c]) => (
                        <div key={l} className="ev-cm-av" style={{ background: b, color: c }}>{l}</div>
                      ))}
                      <div className="ev-cm-av" style={{ background: "var(--ev-gray-100)", color: "var(--ev-gray-500)", fontSize: 7 }}>+29</div>
                    </div>
                    <div className="ev-clubmate-text"><strong>Sofia L., Yuki T., Alena L.</strong> and 31 other Hackney RC members are going</div>
                  </div>
                </div>
              </div>
            )}

            {/* Map */}
            {view === "map" && (
              <div className="ev-map-view">
                <div className="ev-map-bg">
                  <div className="ev-map-grid" />
                  {MAP_PINS.map((pin, i) => (
                    <div key={i} className="ev-map-pin" style={{ left: pin.left, top: pin.top }} onClick={() => showToast(pin.toast)}>
                      <div className="ev-mp-bubble" style={{ background: pin.bg, color: pin.color, borderColor: pin.border }}>{pin.label}</div>
                      <div className="ev-mp-tail" style={{ borderTopColor: pin.bg }} />
                    </div>
                  ))}
                  <span style={{ position: "relative", zIndex: 1, fontSize: 12, color: "var(--ev-gray-500)", background: "white", padding: "4px 12px", borderRadius: 20, border: "1px solid var(--ev-gray-200)" }}>
                    2,100 events across London · click pins to preview
                  </span>
                  <div className="ev-map-legend">
                    {[["var(--ev-yellow)","Featured"],["var(--ev-green)","Going"],["var(--ev-orange)","Club event"],["var(--ev-blue)","Cycling"],["var(--ev-purple)","Climbing"]].map(([c,l]) => (
                      <div key={l} className="ev-ml-item"><div className="ev-ml-dot" style={{ background: c }} />{l}</div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Section header */}
            {view !== "map" && (
              <div className="ev-section-header">
                <div className="ev-section-title">Upcoming events near you</div>
                <div className="ev-section-meta">{visibleCards.length} events · London · sorted by date</div>
              </div>
            )}

            {/* Events grid + load more */}
            {view !== "map" && (
              <div>
                <div className={`ev-events-grid${view === "list" ? " list-mode" : ""}`}>
                  {visibleCards.map((card, idx) => renderCard(card, idx))}
                </div>
                <div className="ev-load-more">
                  {!loadedMore
                    ? <button className="ev-load-btn" onClick={() => { setLoadedMore(true); showToast("Loading more events…"); }}>Load more events</button>
                    : <p style={{ fontSize: 13, color: "var(--ev-gray-400)", padding: 16, margin: 0 }}>All nearby events loaded</p>}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT SIDEBAR */}
          <div className="ev-sidebar-col">

            <div className="ev-ai-rec-card">
              <div className="ev-ai-rec-label">✦ AI coach recommendation</div>
              <div className="ev-ai-rec-text">Based on your 1:54 HM PB and current 62km/week training, the <strong>London Half Marathon (Apr 13)</strong> is a strong PB target. Your AI coach projects 1:50–1:52 at current form. 34 Hackney RC members are going — ideal for pacing support in the final 5km.</div>
            </div>

            {/* Your RSVPs */}
            <div className="ev-side-card">
              <div className="ev-sc-header">
                <span className="ev-sc-title">📋 Your RSVPs</span>
                <span className="ev-sc-link" onClick={() => showToast("Opening your events list…")}>Manage all →</span>
              </div>
              <div className="ev-stats-strip" style={{ borderBottom: "var(--ev-border)" }}>
                <div className="ev-stat-block"><div className="ev-sb-val" style={{ color: "var(--ev-green)" }}>2</div><div className="ev-sb-label">Going</div></div>
                <div className="ev-stat-block"><div className="ev-sb-val" style={{ color: "var(--ev-orange)" }}>1</div><div className="ev-sb-label">Pending</div></div>
                <div className="ev-stat-block"><div className="ev-sb-val">3</div><div className="ev-sb-label">Interested</div></div>
              </div>
              {[
                { id: "london-half",      dot: "going", dateBg: "var(--ev-yellow)",       dayC: "var(--ev-gray-900)", monC: "var(--ev-gray-700)", day: "13", mon: "Apr", name: "London Half Marathon",  sport: "Running · Blackheath",        s: "going" },
                { id: "victoria-parkrun", dot: "going", dateBg: "var(--ev-gray-100)",     dayC: "var(--ev-gray-700)", monC: "var(--ev-gray-500)", day: "19", mon: "Apr", name: "Victoria Park Parkrun", sport: "Running · Club event",        s: "going" },
                { id: "hackney-half",     dot: "pend",  dateBg: "var(--ev-orange-light)", dayC: "#9A3412",            monC: "#C2410C",            day: "3",  mon: "May", name: "Hackney Half Marathon", sport: "Running · 8 clubmates going", s: "pend" },
              ].map(item => (
                <div key={item.id} className="ev-rsvp-item" onClick={() => setModal({ cardId: item.id, modalId: item.id as ModalId })}>
                  <div className={item.dot === "going" ? "ev-going-dot" : "ev-pend-dot"} />
                  <div className="ev-ri-date-box" style={{ background: item.dateBg }}>
                    <div className="ev-ri-day" style={{ color: item.dayC }}>{item.day}</div>
                    <div className="ev-ri-mon" style={{ color: item.monC }}>{item.mon}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="ev-ri-name">{item.name}</div>
                    <div className="ev-ri-sport">{item.sport}</div>
                  </div>
                  <span className={`ev-ri-status ${item.s === "going" ? "ev-ris-going" : "ev-ris-pend"}`}>{item.s === "going" ? "✓ Going" : "Pending"}</span>
                </div>
              ))}
            </div>

            {/* Near you this month */}
            <div className="ev-side-card">
              <div className="ev-sc-header">
                <span className="ev-sc-title">📍 Near you this month</span>
                <span className="ev-sc-link" onClick={() => setViewMode("map")}>Map view →</span>
              </div>
              {[
                { date: "19 Apr", name: "Victoria Park Parkrun",  cls: "run", label: "Run",   dist: "0.4 mi", id: "victoria-parkrun"  as ModalId },
                { date: "17 May", name: "East End 10K",           cls: "run", label: "Run",   dist: "0.4 mi", id: "east-end-10k"      as ModalId },
                { date: "3 May",  name: "Hackney Half Marathon",  cls: "run", label: "Run",   dist: "1.1 mi", id: "hackney-half"      as ModalId },
                { date: "10 May", name: "Arch Bouldering Open",   cls: "clm", label: "Climb", dist: "2.8 mi", id: "arch-open"         as ModalId },
                { date: "26 Apr", name: "Richmond Sportive",      cls: "cyc", label: "Cycle", dist: "8.2 mi", id: "richmond-sportive" as ModalId },
              ].map(item => (
                <div key={item.id} className="ev-nearby-item" onClick={() => setModal({ cardId: item.id, modalId: item.id })}>
                  <div className="ev-ni-date">{item.date}</div>
                  <div style={{ flex: 1 }}>
                    <div className="ev-ni-name">{item.name}</div>
                    <span className={`ev-tag ev-t-${item.cls}`} style={{ fontSize: 10, padding: "1px 6px" }}>{item.label}</span>
                  </div>
                  <div className="ev-ni-dist">{item.dist}</div>
                </div>
              ))}
            </div>

            {/* Hackney RC events */}
            <div className="ev-side-card">
              <div className="ev-sc-header">
                <span className="ev-sc-title">🏃 Hackney RC events</span>
                <span className="ev-sc-link" onClick={() => showToast("Opening club events…")}>All →</span>
              </div>
              <div className="ev-club-ev-item" onClick={() => setModal({ cardId: "london-half", modalId: "london-half" })}>
                <div className="ev-going-dot" />
                <div style={{ width: 28, height: 28, background: "var(--ev-yellow)", borderRadius: 6, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, fontFamily: "var(--ev-mono)", color: "var(--ev-gray-900)", lineHeight: 1 }}>13</div>
                  <div style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase" as const, color: "var(--ev-gray-700)" }}>Apr</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ev-gray-900)" }}>London Half Marathon</div>
                  <div style={{ fontSize: 10, color: "var(--ev-gray-500)" }}>34 going · coach organised</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, color: "#166534" }}>Going</span>
              </div>
              <div className="ev-club-ev-item" onClick={() => setModal({ cardId: "victoria-parkrun", modalId: "victoria-parkrun" })}>
                <div className="ev-going-dot" />
                <div style={{ width: 28, height: 28, background: "var(--ev-gray-100)", borderRadius: 6, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, fontFamily: "var(--ev-mono)", color: "var(--ev-gray-700)", lineHeight: 1 }}>19</div>
                  <div style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase" as const, color: "var(--ev-gray-500)" }}>Apr</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ev-gray-900)" }}>Victoria Park Parkrun</div>
                  <div style={{ fontSize: 10, color: "var(--ev-gray-500)" }}>22 going · free</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, color: "#166534" }}>Going</span>
              </div>
              <div className="ev-club-ev-item" style={{ background: "var(--ev-yellow-light)" }} onClick={() => setModal({ cardId: "hackney-half", modalId: "hackney-half" })}>
                <div className="ev-pend-dot" />
                <div style={{ width: 28, height: 28, background: "var(--ev-orange-light)", borderRadius: 6, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, fontFamily: "var(--ev-mono)", color: "#9A3412", lineHeight: 1 }}>3</div>
                  <div style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase" as const, color: "#C2410C" }}>May</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ev-gray-900)" }}>Hackney Half Marathon</div>
                  <div style={{ fontSize: 10, color: "var(--ev-orange)" }}>RSVP by May 1 — 8 days left</div>
                </div>
                {cardRsvp["hackney-half"]
                  ? <span style={{ fontSize: 10, fontWeight: 600, color: "#166534" }}>Going</span>
                  : <button className="ev-rsvp-btn default" style={{ padding: "3px 8px", fontSize: 10 }} onClick={e => quickRsvp("hackney-half", e)}>RSVP</button>}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── EVENT DETAIL MODAL ── */}
      {modal && mh && (
        <div className="ev-modal-overlay" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="ev-modal">
            <div className="ev-modal-header">
              <div className="ev-modal-event-hero">
                <div className="ev-modal-date-box" style={{ background: mh.dateBg, border: mh.hasBorder ? "1px solid var(--ev-yellow-dark)" : "none" }}>
                  <div className="ev-mdb-day" style={{ color: mh.dayColor }}>{mh.day}</div>
                  <div className="ev-mdb-mon" style={{ color: mh.monColor }}>{mh.mon}</div>
                </div>
                <div className="ev-modal-event-info">
                  <div style={{ marginBottom: 8, display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {mh.tags.map((t, i) => <span key={i} className={`ev-tag ev-t-${t.cls}`}>{t.label}</span>)}
                  </div>
                  <h2>{mh.title}</h2>
                  <p>{mh.meta}</p>
                </div>
              </div>
              <button className="ev-modal-close" onClick={closeModal}>✕</button>
            </div>
            <div className="ev-modal-body">{renderModalBody()}</div>
            <div className="ev-modal-footer">
              {!hasInlineRsvp && (
                <>
                  <button className="ev-btn ev-btn-yellow" style={{ flex: 1, justifyContent: "center" }} onClick={() => { setCardRsvp(prev => ({ ...prev, [modal.cardId]: true })); closeModal(); showToast("✓ RSVP confirmed!"); }}>✓ I'm going</button>
                  <button className="ev-btn" onClick={() => { closeModal(); showToast("Can't make it recorded"); }}>Can't make it</button>
                </>
              )}
              <button className="ev-btn" onClick={closeModal}>Close</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
