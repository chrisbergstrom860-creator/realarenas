import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";

type SportTab = "all" | "run" | "cyc" | "clm" | "swm";
type ViewMode = "grid" | "list";

interface GridCard {
  id: string; sport: SportTab;
  av: string; avBg: string; avColor: string;
  name: string; loc: string;
  tags: Array<{ label: string; cls: string }>;
  stats: Array<{ v: string; l: string }>;
  bars: Array<{ h: number; color: string }>;
  mutual: string; initFollow: boolean;
}

interface NearbyCard {
  dist: string; av: string; avBg: string; avColor: string;
  id: string; name: string; meta: string;
  clubPill?: { label: string; cls: string };
  initFollow: boolean;
}

interface ModalProfile {
  av: string; avBg: string; avColor: string;
  name: string; handle: string;
  tags: string[]; tagStyles: string[];
  stats: Array<{ v: string; l: string }>;
  bio: string;
  initFollowing: boolean;
  activity: { sport: string; sportStyle: string; desc: string; stats: string[]; ai: string };
}

const RUN_BARS = (hs: number[]) => hs.map(h => ({ h, color: "var(--orange)" }));
const CYC_BARS = (hs: number[]) => hs.map(h => ({ h, color: "var(--blue)" }));
const CLM_BARS = (hs: number[]) => hs.map(h => ({ h, color: "var(--purple)" }));
const SWM_BARS = (hs: number[]) => hs.map(h => ({ h, color: "var(--teal)" }));
const GRAY_BAR = { color: "var(--gray-200)" };

const BASE_CARDS: GridCard[] = [
  {
    id: "sofia-l", sport: "run",
    av: "SL", avBg: "#FEF9C3", avColor: "#854D0E",
    name: "Sofia L.", loc: "📍 Prague · @sofialopes",
    tags: [{ label: "🏃 Running", cls: "run" }, { label: "Advanced", cls: "adv" }, { label: "Hackney RC", cls: "club" }],
    stats: [{ v: "9,840", l: "pts" }, { v: "88km", l: "this week" }, { v: "21d", l: "streak" }],
    bars: RUN_BARS([48, 58, 0, 72, 68, 100, 82, 93]).map((b, i) => i === 2 ? { ...GRAY_BAR, h: 35 } : b),
    mutual: "142 followers · coach · Hackney RC", initFollow: true,
  },
  {
    id: "yuki", sport: "run",
    av: "YT", avBg: "#FCE7F3", avColor: "#9D174D",
    name: "Yuki T.", loc: "📍 Tokyo · @yukitri",
    tags: [{ label: "🏃 Running", cls: "run" }, { label: "Advanced", cls: "adv" }, { label: "Hackney RC", cls: "club" }],
    stats: [{ v: "7,610", l: "pts" }, { v: "68km", l: "this week" }, { v: "14d", l: "streak" }],
    bars: RUN_BARS([52, 75, 82, 65, 100, 90, 86, 94]),
    mutual: "98 followers · 3 mutual follows", initFollow: true,
  },
  {
    id: "alena", sport: "run",
    av: "AL", avBg: "#E0F2FE", avColor: "#0369A1",
    name: "Alena L.", loc: "📍 London · @alenaprague",
    tags: [{ label: "🏃 Running", cls: "run" }, { label: "Advanced", cls: "adv" }, { label: "Hackney RC", cls: "club" }, { label: "0.4 mi", cls: "near" }],
    stats: [{ v: "7,220", l: "pts" }, { v: "71km", l: "this week" }, { v: "6d", l: "streak" }],
    bars: [{ h: 30, color: "var(--gray-200)" }, ...RUN_BARS([50, 62, 78, 88, 100, 84, 88])],
    mutual: "76 followers · nearby · Hackney RC", initFollow: true,
  },
  {
    id: "sofia-r", sport: "clm",
    av: "SR", avBg: "#F5F3FF", avColor: "#5B21B6",
    name: "Sofia R.", loc: "📍 Barcelona · @sofiaboulders",
    tags: [{ label: "🧗 Climbing", cls: "clm" }, { label: "Advanced", cls: "adv" }, { label: "✦ Similar level", cls: "similar" }],
    stats: [{ v: "V7", l: "top grade" }, { v: "3×", l: "per week" }, { v: "14d", l: "streak" }],
    bars: CLM_BARS([75, 100, 0, 75, 75, 100, 75, 100]).map((b, i) => i === 2 ? { ...GRAY_BAR, h: 50 } : b),
    mutual: "203 followers · V7 sender", initFollow: true,
  },
  {
    id: "marco", sport: "cyc",
    av: "MC", avBg: "#FEF3C7", avColor: "#92400E",
    name: "Marco C.", loc: "📍 Milan · @marcocycles",
    tags: [{ label: "🚴 Cycling", cls: "cyc" }, { label: "Advanced", cls: "adv" }, { label: "✦ Similar FTP", cls: "similar" }],
    stats: [{ v: "241W", l: "FTP" }, { v: "88km", l: "this week" }, { v: "3.2", l: "W/kg" }],
    bars: CYC_BARS([55, 70, 65, 80, 0, 100, 90, 78]).map((b, i) => i === 4 ? { ...GRAY_BAR, h: 70 } : b),
    mutual: "164 followers · 9-day streak", initFollow: true,
  },
  {
    id: "tom", sport: "run",
    av: "TR", avBg: "#F5F3FF", avColor: "#5B21B6",
    name: "Tom R.", loc: "📍 London · @tomruns",
    tags: [{ label: "🏃 Running", cls: "run" }, { label: "Intermediate", cls: "int" }, { label: "Hackney RC", cls: "club" }, { label: "1.2 mi", cls: "near" }],
    stats: [{ v: "5,880", l: "pts" }, { v: "21km", l: "this week" }, { v: "4d", l: "streak" }],
    bars: RUN_BARS([45, 60, 100, 0, 55, 70, 48, 55]).map((b, i) => i === 3 ? { ...GRAY_BAR, h: 30 } : b),
    mutual: "41 followers · nearby", initFollow: false,
  },
  {
    id: "yuki-n", sport: "swm",
    av: "YN", avBg: "#F0FDFA", avColor: "#134E4A",
    name: "Yuki N.", loc: "📍 London · @yukinswims",
    tags: [{ label: "🏊 Swimming", cls: "swm" }, { label: "Advanced", cls: "adv" }, { label: "3.2 mi", cls: "near" }],
    stats: [{ v: "1:28", l: "/100m" }, { v: "18km", l: "this week" }, { v: "Open", l: "water" }],
    bars: SWM_BARS([65, 80, 70, 0, 85, 100, 75, 82]).map((b, i) => i === 3 ? { ...GRAY_BAR, h: 40 } : b),
    mutual: "88 followers", initFollow: false,
  },
  {
    id: "priya", sport: "run",
    av: "PR", avBg: "#FBEAF0", avColor: "#72243E",
    name: "Priya R.", loc: "📍 Mumbai · @priyaruns",
    tags: [{ label: "🏃 Running", cls: "run" }, { label: "Advanced", cls: "adv" }, { label: "Hackney RC", cls: "club" }, { label: "✦ Same pace", cls: "similar" }],
    stats: [{ v: "6,980", l: "pts" }, { v: "62km", l: "this week" }, { v: "4:24", l: "avg pace" }],
    bars: RUN_BARS([50, 60, 68, 75, 80, 100, 90, 91]),
    mutual: "54 followers · rank #4 Hackney RC", initFollow: false,
  },
];

const MORE_CARDS: GridCard[] = [
  {
    id: "jamie-o", sport: "run",
    av: "JO", avBg: "#FFF7ED", avColor: "#9A3412",
    name: "Jamie O.", loc: "📍 Birmingham · @jamieo",
    tags: [{ label: "🏃 Running", cls: "run" }, { label: "Intermediate", cls: "int" }],
    stats: [{ v: "3,200", l: "pts" }, { v: "18km", l: "this week" }, { v: "5d", l: "streak" }],
    bars: RUN_BARS([40, 55, 48, 62, 70, 58, 65, 50]),
    mutual: "New to Arenas", initFollow: false,
  },
  {
    id: "kai-w", sport: "swm",
    av: "KW", avBg: "#F0FDFA", avColor: "#134E4A",
    name: "Kai W.", loc: "📍 London · @kaiswims",
    tags: [{ label: "🏊 Swimming", cls: "swm" }, { label: "Advanced", cls: "adv" }],
    stats: [{ v: "2,800", l: "pts" }, { v: "14km", l: "this week" }, { v: "8d", l: "streak" }],
    bars: SWM_BARS([60, 70, 65, 80, 75, 90, 85, 88]),
    mutual: "New to Arenas", initFollow: false,
  },
];

const NEARBY: NearbyCard[] = [
  { id: "alena", dist: "0.4 mi", av: "AL", avBg: "#E0F2FE", avColor: "#0369A1", name: "Alena L.", meta: "Running · Advanced · 71km this week", clubPill: { label: "Hackney RC", cls: "club" }, initFollow: true },
  { id: "omar", dist: "0.6 mi", av: "OB", avBg: "#ECFDF5", avColor: "#065F46", name: "Omar B.", meta: "Cycling · Intermediate · 21km this week", clubPill: { label: "Hackney RC", cls: "club" }, initFollow: false },
  { id: "tom", dist: "1.2 mi", av: "TR", avBg: "#F5F3FF", avColor: "#5B21B6", name: "Tom R.", meta: "Running · Intermediate · 4:30/km avg", clubPill: { label: "Hackney RC", cls: "club" }, initFollow: false },
  { id: "jake", dist: "2.8 mi", av: "JH", avBg: "#EEEDFE", avColor: "#3C3489", name: "Jake H.", meta: "Running · Advanced · 4:10/km · 52km this week", initFollow: false },
  { id: "rachel", dist: "3.4 mi", av: "RH", avBg: "#FEF9C3", avColor: "#854D0E", name: "Rachel H.", meta: "Running · Coach · Club organiser", clubPill: { label: "Hackney RC", cls: "club" }, initFollow: false },
  { id: "yuki-n", dist: "3.2 mi", av: "YN", avBg: "#F0FDFA", avColor: "#134E4A", name: "Yuki N.", meta: "Swimming · Advanced · 1:28/100m", initFollow: false },
];

const MODAL_DATA: Record<string, ModalProfile> = {
  "sofia-l": {
    av: "SL", avBg: "#FEF9C3", avColor: "#854D0E", name: "Sofia L.", handle: "@sofialopes · Prague, CZ",
    tags: ["🏃 Running", "Advanced", "Coach", "Hackney RC"],
    tagStyles: ["background:rgba(249,115,22,.2);color:#FDBA74;border-color:rgba(249,115,22,.3)", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8);border-color:rgba(255,255,255,.15)", "background:rgba(16,185,129,.2);color:#6EE7B7;border-color:rgba(16,185,129,.25)", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8);border-color:rgba(255,255,255,.15)"],
    stats: [{ v: "9,840", l: "Points" }, { v: "88km", l: "This week" }, { v: "21d", l: "Streak" }, { v: "142", l: "Followers" }],
    bio: "Long-distance runner and Hackney RC coach. Marathon PB: 3:08. Training group meets Tuesday evenings and Saturday mornings at London Fields.",
    initFollowing: true,
    activity: { sport: "🏃 Running", sportStyle: "background:var(--orange-light);color:#9A3412;border:1px solid #FDBA74", desc: "Sunday progression long run — 18.2km. Held 4:22 for the back half. That's 94.2km this month!", stats: ["18.2 km", "4:24/km", "144 bpm", "1:20:04"], ai: "Negative split execution excellent — second half 4:22 vs 4:26 first half. HR only rose 6 bpm. Full recovery recommended tomorrow." },
  },
  "yuki": {
    av: "YT", avBg: "#FCE7F3", avColor: "#9D174D", name: "Yuki T.", handle: "@yukitri · Tokyo, JP",
    tags: ["🏃 Running", "Advanced", "Hackney RC"],
    tagStyles: ["background:rgba(249,115,22,.2);color:#FDBA74;border-color:rgba(249,115,22,.3)", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8);border-color:rgba(255,255,255,.15)", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8);border-color:rgba(255,255,255,.15)"],
    stats: [{ v: "7,610", l: "Points" }, { v: "68km", l: "This week" }, { v: "14d", l: "Streak" }, { v: "98", l: "Followers" }],
    bio: "Running coach and triathlete based in Tokyo. Sub-3 marathoner. Member of Hackney RC remotely — follows the leaderboard closely from Japan.",
    initFollowing: true,
    activity: { sport: "🏃 Running", sportStyle: "background:var(--orange-light);color:#9A3412;border:1px solid #FDBA74", desc: "Tempo block — 3×5km at 3:58/km. Felt controlled throughout. Fitness is coming together.", stats: ["15.0 km", "4:02/km", "171 bpm"], ai: "Tempo execution was solid. HR at 171 is within your threshold for this effort. The ×3 repeat structure shows excellent pacing discipline." },
  },
  "alena": {
    av: "AL", avBg: "#E0F2FE", avColor: "#0369A1", name: "Alena L.", handle: "@alenaprague · London, UK",
    tags: ["🏃 Running", "Advanced", "Hackney RC", "0.4 mi away"],
    tagStyles: ["background:rgba(249,115,22,.2);color:#FDBA74;border-color:rgba(249,115,22,.3)", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8);border-color:rgba(255,255,255,.15)", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8);border-color:rgba(255,255,255,.15)", "background:rgba(59,130,246,.2);color:#93C5FD;border-color:rgba(59,130,246,.3)"],
    stats: [{ v: "7,220", l: "Points" }, { v: "71km", l: "This week" }, { v: "6d", l: "Streak" }, { v: "76", l: "Followers" }],
    bio: "Czech runner now based in London. Just completed the 100km May Run challenge — first in Hackney RC. Running the Hackney Half in May.",
    initFollowing: true,
    activity: { sport: "🏃 Running", sportStyle: "background:var(--orange-light);color:#9A3412;border:1px solid #FDBA74", desc: "Week 3 of marathon build — biggest week yet at 71.4km and it felt manageable. 100km May Run done ✓", stats: ["71.4 km", "4:30/km", "138 bpm"], ai: "Excellent volume management — your aerobic base is clearly strong. The consistent 4:30 pace across 5+ hour training weeks is very impressive." },
  },
  "sofia-r": {
    av: "SR", avBg: "#F5F3FF", avColor: "#5B21B6", name: "Sofia R.", handle: "@sofiaboulders · Barcelona, ES",
    tags: ["🧗 Climbing", "Advanced", "V7 climber"],
    tagStyles: ["background:rgba(139,92,246,.2);color:#C4B5FD;border-color:rgba(139,92,246,.3)", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8);border-color:rgba(255,255,255,.15)", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8);border-color:rgba(255,255,255,.15)"],
    stats: [{ v: "V7", l: "Top grade" }, { v: "3×/wk", l: "Sessions" }, { v: "14d", l: "Streak" }, { v: "203", l: "Followers" }],
    bio: "Boulderer based in Barcelona projecting V8 at Montserrat. Ex-competition climber. Posts detailed beta in comments — follow for technique breakdowns.",
    initFollowing: true,
    activity: { sport: "🧗 Climbing", sportStyle: "background:var(--purple-light);color:#5B21B6;border:1px solid #C4B5FD", desc: "Sent the V7 at Montserrat after 3 weeks of projecting. Crux was the undercling sequence. Beta in comments.", stats: ["V7 sent", "3 weeks", "project"], ai: "Sending a 3-week project shows excellent persistence. Session volume has been well-managed — the send was earned through smart training, not luck." },
  },
  "marco": {
    av: "MC", avBg: "#FEF3C7", avColor: "#92400E", name: "Marco C.", handle: "@marcocycles · Milan, IT",
    tags: ["🚴 Cycling", "Advanced", "Similar FTP"],
    tagStyles: ["background:rgba(59,130,246,.2);color:#93C5FD;border-color:rgba(59,130,246,.3)", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8);border-color:rgba(255,255,255,.15)", "background:rgba(255,210,30,.2);color:#FDE68A;border-color:rgba(255,210,30,.3)"],
    stats: [{ v: "241W", l: "FTP" }, { v: "88km", l: "This week" }, { v: "3.2", l: "W/kg" }, { v: "164", l: "Followers" }],
    bio: "Cyclist based in Milan targeting gran fondos in the Alps. Weekly rides up Stelvio during summer. Group ride Saturday AM — DM to join.",
    initFollowing: true,
    activity: { sport: "🚴 Cycling", sportStyle: "background:var(--blue-light);color:#1E40AF;border:1px solid #93C5FD", desc: "Stelvio approach — 241W normalised for the full climb which is a PR by 18W. Group ride open Saturday.", stats: ["88 km", "241W", "1,240m"], ai: "241W normalised on Stelvio is outstanding. Your FTP test result is now clearly underestimating your capability — schedule a new test this week." },
  },
  "tom": {
    av: "TR", avBg: "#F5F3FF", avColor: "#5B21B6", name: "Tom R.", handle: "@tomruns · London, UK",
    tags: ["🏃 Running", "Intermediate", "Hackney RC", "1.2 mi away"],
    tagStyles: ["background:rgba(249,115,22,.2);color:#FDBA74", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8)", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8)", "background:rgba(59,130,246,.2);color:#93C5FD"],
    stats: [{ v: "5,880", l: "Points" }, { v: "21km", l: "This week" }, { v: "4d", l: "Streak" }, { v: "41", l: "Followers" }],
    bio: "Social runner based in East London. Hackney RC Tuesday track sessions. Working toward a sub-25 5K — down from 27:30 last year.",
    initFollowing: false,
    activity: { sport: "🏃 Running", sportStyle: "background:var(--orange-light);color:#9A3412;border:1px solid #FDBA74", desc: "Tuesday track session with Hackney RC — 6×800m at 5K pace. Felt strong on the last two reps.", stats: ["4.8 km", "4:30/km", "158 bpm"], ai: "Pacing improvement on the final two reps suggests your aerobic fitness is progressing well. Keep these track sessions weekly." },
  },
  "priya": {
    av: "PR", avBg: "#FBEAF0", avColor: "#72243E", name: "Priya R.", handle: "@priyaruns · Mumbai, IN",
    tags: ["🏃 Running", "Advanced", "Hackney RC", "Same pace"],
    tagStyles: ["background:rgba(249,115,22,.2);color:#FDBA74", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8)", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8)", "background:rgba(255,210,30,.2);color:#FDE68A"],
    stats: [{ v: "6,980", l: "Points" }, { v: "62km", l: "This week" }, { v: "4:24", l: "Avg pace" }, { v: "54", l: "Followers" }],
    bio: "Runner and product designer based in Mumbai. Competing remotely with Hackney RC. HM PB 1:56 and chasing sub-1:50. AI coaching fan.",
    initFollowing: false,
    activity: { sport: "🏃 Running", sportStyle: "background:var(--orange-light);color:#9A3412;border:1px solid #FDBA74", desc: "Morning long run in Mumbai — humidity is no joke but pace held well throughout the 16km.", stats: ["16 km", "4:26/km", "152 bpm"], ai: "HR management in high humidity is excellent — 152 bpm average at 4:26 pace shows strong heat adaptation. Great aerobic base work." },
  },
  "omar": {
    av: "OB", avBg: "#ECFDF5", avColor: "#065F46", name: "Omar B.", handle: "@omarbikes · London, UK",
    tags: ["🚴 Cycling", "Intermediate", "Hackney RC", "0.6 mi away"],
    tagStyles: ["background:rgba(59,130,246,.2);color:#93C5FD", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8)", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8)", "background:rgba(59,130,246,.2);color:#93C5FD"],
    stats: [{ v: "4,100", l: "Points" }, { v: "21km", l: "This week" }, { v: "4d", l: "Streak" }, { v: "29", l: "Followers" }],
    bio: "Cyclist and occasional runner based in Hackney. Commutes by bike daily and does weekend leisure rides. Working on getting a power meter.",
    initFollowing: false,
    activity: { sport: "🚴 Cycling", sportStyle: "background:var(--blue-light);color:#1E40AF;border:1px solid #93C5FD", desc: "Evening loop through Victoria Park and back — casual 21km to wind down after a long week.", stats: ["21 km", "25km/h", "138 bpm"], ai: "Solid Zone 2 effort — HR of 138 is perfect recovery pace. These easy rides are building your aerobic base more than you might think." },
  },
  "kate": {
    av: "KM", avBg: "#EEEDFE", avColor: "#3C3489", name: "Kate M.", handle: "@katemclimbs · Bristol, UK",
    tags: ["🧗 Climbing", "Advanced", "V5 climber"],
    tagStyles: ["background:rgba(139,92,246,.2);color:#C4B5FD", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8)", "background:rgba(255,210,30,.2);color:#FDE68A"],
    stats: [{ v: "V5", l: "Top grade" }, { v: "3×/wk", l: "Sessions" }, { v: "Projecting", l: "V6" }, { v: "88", l: "Followers" }],
    bio: "Boulderer and route setter at The Climbing Academy Bristol. Projecting a V6 compression problem at Avon Gorge. Posts climbing journals weekly.",
    initFollowing: false,
    activity: { sport: "🧗 Climbing", sportStyle: "background:var(--purple-light);color:#5B21B6;border:1px solid #C4B5FD", desc: "V5 flash at the climbing gym — felt like the strongest session in months. Starting a V6 project next week.", stats: ["V5 flash", "2h 30m", "6 problems"], ai: "A flash at your current limit shows your technique has improved significantly. The next training block should focus on the specific movement type of your V6 project." },
  },
  "yuki-n": {
    av: "YN", avBg: "#F0FDFA", avColor: "#134E4A", name: "Yuki N.", handle: "@yukinswims · London, UK",
    tags: ["🏊 Swimming", "Advanced", "Open water"],
    tagStyles: ["background:rgba(20,184,166,.2);color:#5EEAD4", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8)", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8)"],
    stats: [{ v: "1:28", l: "/100m pace" }, { v: "18km", l: "This week" }, { v: "88", l: "Followers" }, { v: "3.2 mi", l: "From you" }],
    bio: "Open water swimmer and triathlete. Swims at Hampstead Heath Ponds year-round. Training for the Tooting Bec open water season.",
    initFollowing: false,
    activity: { sport: "🏊 Swimming", sportStyle: "background:var(--teal-light);color:#134E4A;border:1px solid #5EEAD4", desc: "Long pool session — 4km at mixed pace. Open water preparation work, focusing on sighting drills.", stats: ["4 km", "1:28/100m", "132 bpm"], ai: "Your pace consistency across the 4km set is excellent — deviation of only 3s/100m across all intervals indicates strong pacing control." },
  },
  "jake": {
    av: "JH", avBg: "#EEEDFE", avColor: "#3C3489", name: "Jake H.", handle: "@jakehurst · London, UK",
    tags: ["🏃 Running", "Advanced", "4:10/km pace"],
    tagStyles: ["background:rgba(249,115,22,.2);color:#FDBA74", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8)", "background:rgba(255,210,30,.2);color:#FDE68A"],
    stats: [{ v: "52km", l: "This week" }, { v: "4:10", l: "Avg pace" }, { v: "2.8 mi", l: "From you" }, { v: "67", l: "Followers" }],
    bio: "Freelance photographer and runner. No club yet — looking for a Tuesday track group in Hackney. Sub-3 marathon ambition.",
    initFollowing: false,
    activity: { sport: "🏃 Running", sportStyle: "background:var(--orange-light);color:#9A3412;border:1px solid #FDBA74", desc: "Early morning tempo — 12km at threshold pace. New pair of shoes making a real difference.", stats: ["12 km", "4:08/km", "162 bpm"], ai: "Excellent threshold work — 162 bpm at 4:08 is very efficient for your fitness level. This is exactly the right training to reach sub-3 marathon form." },
  },
  "rachel": {
    av: "RH", avBg: "#FEF9C3", avColor: "#854D0E", name: "Rachel H.", handle: "@rachelhackney · London, UK",
    tags: ["🏃 Running", "Coach", "Hackney RC organiser"],
    tagStyles: ["background:rgba(249,115,22,.2);color:#FDBA74", "background:rgba(16,185,129,.2);color:#6EE7B7;border-color:rgba(16,185,129,.25)", "background:rgba(255,255,255,.1);color:rgba(255,255,255,.8)"],
    stats: [{ v: "48", l: "Members coached" }, { v: "5 yrs", l: "Coaching" }, { v: "142", l: "Followers" }, { v: "3.4 mi", l: "From you" }],
    bio: "Head coach at Hackney Running Club. Tuesday evenings, Saturday long runs. All abilities welcome. DM to join the club.",
    initFollowing: false,
    activity: { sport: "🏃 Running", sportStyle: "background:var(--orange-light);color:#9A3412;border:1px solid #FDBA74", desc: "Club session — 10×400m with the Tuesday group. Proud of how the newer members are progressing.", stats: ["6 km", "4:45/km", "145 bpm"], ai: "As a coach running alongside athletes, your controlled HR shows excellent pacing awareness. You're modelling exactly the right behaviour for your athletes." },
  },
};

function parseStyleStr(s: string): React.CSSProperties {
  const obj: Record<string, string> = {};
  s.split(";").forEach(part => {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) return;
    const key = part.slice(0, colonIdx).trim();
    const val = part.slice(colonIdx + 1).trim();
    if (!key || !val) return;
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    obj[camel] = val;
  });
  return obj as React.CSSProperties;
}

const PILL_CLS: Record<string, string> = {
  run: "at-pill-run", cyc: "at-pill-cyc", clm: "at-pill-clm", swm: "at-pill-swm",
  adv: "at-pill-adv", int: "at-pill-int", club: "at-pill-club", near: "at-pill-near",
  similar: "at-pill-similar",
};

const TAB_COUNTS: Record<SportTab, number> = { all: 48, run: 28, cyc: 11, clm: 6, swm: 3 };

export default function Athletes() {
  const [, setLocation] = useLocation();
  const { logout } = useAuth();

  const [showFilter, setShowFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");
  const [locFilter, setLocFilter] = useState("near");
  const [actFilter, setActFilter] = useState("week");
  const [sportTab, setSportTab] = useState<SportTab>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [search, setSearch] = useState("");
  const [modalId, setModalId] = useState<string | null>(null);
  const [modalFollowing, setModalFollowing] = useState(false);
  const [followed, setFollowed] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    [...BASE_CARDS, ...MORE_CARDS].forEach(c => { init[c.id] = c.initFollow; });
    NEARBY.forEach(n => { if (!(n.id in init)) init[n.id] = n.initFollow; });
    return init;
  });
  const [loaded, setLoaded] = useState(false);
  const [joinedClubs, setJoinedClubs] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  function showToast(msg: string) {
    setToast(msg); setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2800);
  }

  function toggleFollow(id: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    setFollowed(prev => {
      const next = { ...prev, [id]: !prev[id] };
      showToast(next[id] ? "✓ Following — their activities will appear in your feed" : "Unfollowed");
      return next;
    });
  }

  function openModal(id: string) {
    const profile = MODAL_DATA[id];
    if (!profile) return;
    setModalId(id);
    setModalFollowing(profile.initFollowing);
  }

  function closeModal(e?: React.MouseEvent) {
    if (!e || (e.target as HTMLElement).classList.contains("at-modal-overlay")) {
      setModalId(null);
    }
  }

  function modalToggleFollow() {
    const next = !modalFollowing;
    setModalFollowing(next);
    showToast(next ? "✓ Following — their activities will appear in your feed" : "Unfollowed");
  }

  const visibleCards = useMemo(() => {
    const cards = loaded ? [...BASE_CARDS, ...MORE_CARDS] : BASE_CARDS;
    if (sportTab === "all" && !search) return cards;
    return cards.filter(c => {
      const matchSport = sportTab === "all" || c.sport === sportTab;
      const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.loc.toLowerCase().includes(search.toLowerCase());
      return matchSport && matchSearch;
    });
  }, [sportTab, search, loaded]);

  const showRec = !search;
  const showNearby = !search;
  const athleteCount = search ? visibleCards.length : TAB_COUNTS[sportTab];

  const modalProfile = modalId ? MODAL_DATA[modalId] : null;

  function NavItem({ to, icon, label, badge, badgeRed, active }: { to?: string; icon: string; label: string; badge?: string; badgeRed?: boolean; active?: boolean }) {
    return (
      <div className={`at-nav-item${active ? " active" : ""}`} onClick={() => to ? setLocation(to) : undefined}>
        <span className="at-nav-icon">{icon}</span> {label}
        {badge && <span className={`at-nav-badge${badgeRed ? " red" : ""}`}>{badge}</span>}
      </div>
    );
  }

  return (
    <div className="at-app">

      <header className="at-topbar">
        <div className="at-topbar-logo">
          <div className="at-logo-icon">🏟</div>
          <span className="at-logo-text">Arenas</span>
        </div>
        <div className="at-topbar-center">
          <div className="at-topbar-search">
            <span style={{ color: "var(--gray-400)", fontSize: 13 }}>🔍</span>
            <input
              type="text"
              placeholder="Search by name, sport, location, pace…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="at-topbar-live"><div className="at-live-dot" />84,000+ athletes</div>
        </div>
        <div className="at-topbar-actions">
          <div className="at-icon-btn" onClick={() => showToast("Opening notifications…")}>🔔<div className="at-notif-dot" /></div>
          <div className="at-user-av" onClick={() => setLocation("/profile")}>JK</div>
        </div>
      </header>

      <aside className="at-sidebar">
        <div className="at-nav-label">My Arenas</div>
        <NavItem to="/feed" icon="🏠" label="Feed" />
        <NavItem to="/profile" icon="👤" label="My profile" />
        <NavItem to="/events" icon="📅" label="Events" />
        <NavItem icon="🏆" label="Leaderboards" />
        <NavItem icon="⚡" label="Challenges" badge="3" />
        <NavItem icon="👥" label="Athletes" active />
        <div className="at-nav-label">My clubs</div>
        <NavItem icon="🏃" label="Hackney RC" badge="2" badgeRed />
        <div className="at-nav-label">Account</div>
        <NavItem icon="⚙️" label="Settings" />
        <NavItem icon="💳" label="Pro plan" />
        <div className="at-sidebar-footer">
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div className="at-user-av" style={{ width: 30, height: 30, flexShrink: 0, fontSize: 11 }}>JK</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--gray-900)" }}>Jamie King</div>
              <div style={{ fontSize: 10, color: "var(--gray-500)" }}>@jamiek · Pro</div>
            </div>
            <button className="at-logout-btn" onClick={() => { logout(); setLocation("/"); }}>Log out</button>
          </div>
        </div>
      </aside>

      <div className="at-main">

        <div className="at-filter-zone">
          <div className="at-filter-row">
            <span className="at-f-label">Show</span>
            {[["all", "All athletes"], ["following", "Following"], ["followers", "Followers"], ["hackney", "Hackney RC"], ["recommended", "✦ Recommended"]].map(([v, l]) => (
              <div key={v} className={`at-f-pill${showFilter === v ? " on" : ""}`} onClick={() => { setShowFilter(v); showToast("Filter: " + l); }}>{l}</div>
            ))}
            <div className="at-f-sep" />
            <span className="at-f-label">Level</span>
            {[["all", "All levels"], ["advanced", "Advanced"], ["intermediate", "Intermediate"], ["beginner", "Beginner"]].map(([v, l]) => (
              <div key={v} className={`at-f-pill${levelFilter === v ? " on" : ""}`} onClick={() => { setLevelFilter(v); showToast("Filter: " + l); }}>{l}</div>
            ))}
          </div>
          <div className="at-filter-row">
            <span className="at-f-label">Location</span>
            {[["near", "Near me"], ["london", "London"], ["uk", "UK"], ["global", "Global"]].map(([v, l]) => (
              <div key={v} className={`at-f-pill${locFilter === v ? " on" : ""}`} onClick={() => { setLocFilter(v); showToast("Filter: " + l); }}>{l}</div>
            ))}
            <div className="at-f-sep" />
            <span className="at-f-label">Activity</span>
            {[["week", "Active this week"], ["month", "Active this month"], ["all", "All time"]].map(([v, l]) => (
              <div key={v} className={`at-f-pill${actFilter === v ? " on" : ""}`} onClick={() => { setActFilter(v); showToast("Filter: " + l); }}>{l}</div>
            ))}
            <div className="at-f-right">
              <span className="at-athlete-count">{athleteCount} athletes</span>
              <div className="at-view-toggle">
                <div className={`at-vt-btn${viewMode === "grid" ? " on" : ""}`} onClick={() => { setViewMode("grid"); showToast("Grid view"); }}>⊞ Grid</div>
                <div className={`at-vt-btn${viewMode === "list" ? " on" : ""}`} onClick={() => { setViewMode("list"); showToast("List view"); }}>☰ List</div>
              </div>
              <select className="at-sort-select" onChange={e => showToast("Sorted: " + e.target.value)}>
                <option>Sort: Most active</option>
                <option>Sort: Nearest first</option>
                <option>Sort: Points</option>
                <option>Sort: New to Arenas</option>
                <option>Sort: Mutual followers</option>
              </select>
            </div>
          </div>
        </div>

        <div className="at-body-grid">
          <div className="at-athletes-col">

            {showRec && (
              <div id="at-rec-section">
                <div className="at-section-hdr" style={{ position: "relative", top: "auto" }}>
                  <span className="at-sh-title">✦ Recommended for you · <span style={{ fontWeight: 400, color: "var(--gray-500)" }}>based on your sports, location and training</span></span>
                  <span className="at-sh-link" onClick={() => showToast("Loading more recommendations…")}>Refresh →</span>
                </div>
                <div className="at-rec-strip">
                  {[
                    { id: "priya", av: "PR", avBg: "#FBEAF0", avColor: "#72243E", name: "Priya R.", handle: "@priyaruns · Mumbai", why: "Hackney RC · rank #4 · same pace bracket as you (4:20–4:30/km)", stats: [{ v: "6,980", l: "pts" }, { v: "62km", l: "/wk" }, { v: "6d", l: "streak" }], delay: ".05s" },
                    { id: "marco", av: "MC", avBg: "#FEF3C7", avColor: "#92400E", name: "Marco C.", handle: "@marcocycles · Milan", why: "Similar FTP to you (241W vs your 241W) · both targeting Stelvio climbs", stats: [{ v: "3.2", l: "W/kg" }, { v: "88km", l: "/wk" }, { v: "241W", l: "FTP" }], delay: ".1s" },
                    { id: "omar", av: "OB", avBg: "#ECFDF5", avColor: "#065F46", name: "Omar B.", handle: "@omarbikes · London", why: "0.6 mi from you · trains the same Hackney Marshes routes on Tuesdays", stats: [{ v: "4,100", l: "pts" }, { v: "21km", l: "/wk" }, { v: "Hackney RC", l: "" }], delay: ".15s" },
                    { id: "kate", av: "KM", avBg: "#EEEDFE", avColor: "#3C3489", name: "Kate M.", handle: "@katemclimbs · Bristol", why: "V5 climber — you're projecting V6. Following her beta could help your send.", stats: [{ v: "V5", l: "grade" }, { v: "3×", l: "/week" }, { v: "Adv", l: "" }], delay: ".2s" },
                  ].map(rc => (
                    <div key={rc.id} className="at-rec-card" style={{ animationDelay: rc.delay }} onClick={() => openModal(rc.id)}>
                      <div className="at-rc-av" style={{ background: rc.avBg, color: rc.avColor }}>{rc.av}</div>
                      <div>
                        <div className="at-rc-name">{rc.name}</div>
                        <div className="at-rc-handle">{rc.handle}</div>
                      </div>
                      <div className="at-rc-why">{rc.why}</div>
                      <div className="at-rc-stats">
                        {rc.stats.map((s, i) => (
                          <div key={i} className="at-rc-stat"><strong>{s.v}</strong>{s.l ? " " + s.l : ""}</div>
                        ))}
                      </div>
                      <button
                        className={`at-follow-btn${followed[rc.id] ? " following" : " default"}`}
                        onClick={e => toggleFollow(rc.id, e)}
                      >{followed[rc.id] ? "Following" : "Follow"}</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="at-sport-tabs">
              {([["all", "All sports"], ["run", "🏃 Running"], ["cyc", "🚴 Cycling"], ["clm", "🧗 Climbing"], ["swm", "🏊 Swimming"]] as [SportTab, string][]).map(([s, l]) => (
                <div key={s} className={`at-sport-tab${sportTab === s ? " on" : ""}`} onClick={() => setSportTab(s)}>
                  {l} <span className="at-tab-count">{TAB_COUNTS[s]}</span>
                </div>
              ))}
            </div>

            <div className={`at-athlete-grid${viewMode === "list" ? " list-view" : " grid-2"}`}>
              {visibleCards.map((card, idx) => (
                <div
                  key={card.id}
                  className="at-athlete-card"
                  style={{ animationDelay: `${(idx % 8) * 0.05 + 0.05}s` }}
                  onClick={() => openModal(card.id)}
                >
                  <div className="at-ac-head">
                    <div className="at-ac-av" style={{ background: card.avBg, color: card.avColor }}>{card.av}</div>
                    <div><div className="at-ac-name">{card.name}</div><div className="at-ac-location">{card.loc}</div></div>
                  </div>
                  <div className="at-ac-tags">
                    {card.tags.map((t, i) => (
                      <span key={i} className={`at-pill ${PILL_CLS[t.cls] || ""}`}>{t.label}</span>
                    ))}
                  </div>
                  <div className="at-ac-mini-stats">
                    {card.stats.map((s, i) => (
                      <div key={i} className="at-ms-item"><span className="at-ms-val">{s.v}</span><span className="at-ms-label">{s.l}</span></div>
                    ))}
                  </div>
                  {viewMode === "grid" && (
                    <div className="at-sparkline-wrap">
                      <div className="at-sparkline-label"><span>8 weeks</span></div>
                      <div className="at-sparkline">
                        {card.bars.map((b, i) => (
                          <div key={i} className="at-spark-bar" style={{ height: `${b.h}%`, background: b.color }} />
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="at-ac-footer">
                    <div className="at-ac-mutual">{card.mutual}</div>
                    <button
                      className={`at-follow-btn${followed[card.id] ? " following" : " default"}`}
                      onClick={e => toggleFollow(card.id, e)}
                    >{followed[card.id] ? "Following" : "Follow"}</button>
                  </div>
                </div>
              ))}
            </div>

            {showNearby && (
              <div>
                <div className="at-section-hdr" style={{ position: "relative", top: "auto" }}>
                  <span className="at-sh-title">📍 Athletes near you · London</span>
                  <span className="at-sh-link" onClick={() => showToast("Opening map view…")}>See on map →</span>
                </div>
                <div className="at-nearby-grid">
                  {NEARBY.map((n, idx) => (
                    <div key={n.id + idx} className="at-nearby-card" style={{ animationDelay: `${idx * 0.05 + 0.05}s` }} onClick={() => openModal(n.id)}>
                      <div className="at-nb-dist">{n.dist}</div>
                      <div className="at-nb-av" style={{ background: n.avBg, color: n.avColor }}>{n.av}</div>
                      <div className="at-nb-info">
                        <div className="at-nb-name">{n.name}</div>
                        <div className="at-nb-meta">{n.meta}</div>
                        {n.clubPill && (
                          <div className="at-nb-tags"><span className={`at-pill ${PILL_CLS[n.clubPill.cls]}`}>{n.clubPill.label}</span></div>
                        )}
                        {!n.clubPill && (
                          <div className="at-nb-tags"><span className="at-pill at-pill-int">No clubs yet</span></div>
                        )}
                      </div>
                      <button
                        className={`at-follow-btn at-follow-sm${followed[n.id] ? " following" : " default"}`}
                        onClick={e => toggleFollow(n.id, e)}
                      >{followed[n.id] ? "Following" : "Follow"}</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="at-load-more">
              {loaded ? (
                <p style={{ fontSize: 13, color: "var(--gray-400)", padding: 16 }}>All athletes in your area loaded</p>
              ) : (
                <button className="at-load-btn" onClick={() => { setLoaded(true); showToast("Loaded more athletes"); }}>
                  Load more athletes
                </button>
              )}
            </div>

          </div>

          <div className="at-sidebar-col">

            <div className="at-side-card">
              <div className="at-sc-header">
                <span className="at-sc-title">People you follow</span>
                <span className="at-sc-link" onClick={() => showToast("Opening full following list…")}>All 89 →</span>
              </div>
              {[
                { id: "sofia-l", av: "SL", bg: "#FEF9C3", color: "#854D0E", name: "Sofia L.", meta: "🔥 21d · 88km" },
                { id: "yuki", av: "YT", bg: "#FCE7F3", color: "#9D174D", name: "Yuki T.", meta: "🔥 14d · 68km" },
                { id: "alena", av: "AL", bg: "#E0F2FE", color: "#0369A1", name: "Alena L.", meta: "🔥 6d · 71km" },
                { id: "sofia-r", av: "SR", bg: "#F5F3FF", color: "#5B21B6", name: "Sofia R.", meta: "V7 sent ✓" },
                { id: "marco", av: "MC", bg: "#FEF3C7", color: "#92400E", name: "Marco C.", meta: "🔥 9d · 88km" },
              ].map(f => (
                <div key={f.id} className="at-following-item" onClick={() => openModal(f.id)}>
                  <div className="at-fi-av" style={{ background: f.bg, color: f.color }}>{f.av}</div>
                  <div className="at-fi-name">{f.name}</div>
                  <div className="at-fi-meta">{f.meta}</div>
                </div>
              ))}
            </div>

            <div className="at-side-card">
              <div className="at-sc-header"><span className="at-sc-title">Your network</span></div>
              <div className="at-network-stats">
                <div className="at-ns-item">
                  <div className="at-ns-val">89</div>
                  <div className="at-ns-label">Following</div>
                </div>
                <div className="at-ns-item">
                  <div className="at-ns-val">142</div>
                  <div className="at-ns-label">Followers</div>
                  <div className="at-ns-delta">↑ +4 this week</div>
                </div>
              </div>
              <div style={{ padding: "8px 14px", borderTop: "var(--border)", fontSize: 12, color: "var(--gray-600)" }}>
                Priya R., Jake H. and 2 others followed you this week
              </div>
            </div>

            <div className="at-side-card">
              <div className="at-sc-header"><span className="at-sc-title">Your network by sport</span></div>
              {[
                { sport: "🏃 Running", pct: "71%", color: "var(--orange)", count: 63 },
                { sport: "🚴 Cycling", pct: "18%", color: "var(--blue)", count: 16 },
                { sport: "🧗 Climbing", pct: "7%", color: "var(--purple)", count: 6 },
                { sport: "🏊 Swimming", pct: "4%", color: "var(--teal)", count: 4 },
              ].map(b => (
                <div key={b.sport} className="at-sport-bar-row">
                  <span className="at-sbar-sport">{b.sport}</span>
                  <div className="at-sbar-track"><div className="at-sbar-fill" style={{ width: b.pct, background: b.color }} /></div>
                  <span className="at-sbar-count">{b.count}</span>
                </div>
              ))}
            </div>

            <div className="at-side-card">
              <div className="at-sc-header">
                <span className="at-sc-title">Clubs to discover</span>
                <span className="at-sc-link" onClick={() => showToast("Browsing all clubs…")}>Browse all →</span>
              </div>
              {[
                { id: "slcc", icon: "🚴", bg: "var(--blue-light)", name: "South London CC", meta: "64 members · Cycling · South London" },
                { id: "eec", icon: "🧗", bg: "var(--purple-light)", name: "East End Climbers", meta: "28 members · Bouldering · Bethnal Green" },
                { id: "ltc", icon: "🔱", bg: "#FBEAF0", name: "London Tri Club", meta: "120 members · Triathlon · All London" },
              ].map(c => (
                <div key={c.id} className="at-club-suggest" onClick={() => showToast(`Opening ${c.name}…`)}>
                  <div className="at-cs-icon" style={{ background: c.bg }}>{c.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div className="at-cs-name">{c.name}</div>
                    <div className="at-cs-meta">{c.meta}</div>
                  </div>
                  <button
                    className="at-btn at-btn-sm"
                    onClick={e => { e.stopPropagation(); setJoinedClubs(prev => ({ ...prev, [c.id]: true })); showToast(joinedClubs[c.id] ? `Already requested ${c.name}` : "Request sent!"); }}
                  >{joinedClubs[c.id] ? "Requested" : "Join"}</button>
                </div>
              ))}
            </div>

          </div>
        </div>
      </div>

      {modalProfile && (
        <div className="at-modal-overlay open" onClick={closeModal}>
          <div className="at-modal" onClick={e => e.stopPropagation()}>
            <div className="at-modal-hero">
              <div className="at-mh-av" style={{ background: modalProfile.avBg, color: modalProfile.avColor }}>{modalProfile.av}</div>
              <div className="at-mh-info">
                <div className="at-mh-name">{modalProfile.name}</div>
                <div className="at-mh-handle">{modalProfile.handle}</div>
                <div className="at-mh-tags">
                  {modalProfile.tags.map((t, i) => (
                    <span key={i} className="at-mh-tag" style={modalProfile.tagStyles[i] ? parseStyleStr(modalProfile.tagStyles[i]) : {}}>{t}</span>
                  ))}
                </div>
              </div>
              <div className="at-mh-actions">
                <button
                  className="at-btn at-btn-sm"
                  style={modalFollowing ? { background: "var(--green-light)", color: "#166534", borderColor: "#86EFAC" } : { background: "var(--yellow)", color: "var(--gray-900)", borderColor: "var(--yellow-dark)", fontWeight: 600 }}
                  onClick={modalToggleFollow}
                >{modalFollowing ? "✓ Following" : "Follow"}</button>
                <button className="at-btn at-btn-sm" onClick={() => showToast("Opening message…")}>💬 Message</button>
              </div>
              <button className="at-modal-close" onClick={() => setModalId(null)}>✕</button>
            </div>
            <div className="at-modal-body">
              <div className="at-modal-stats">
                {modalProfile.stats.map((s, i) => (
                  <div key={i} className="at-modal-stat"><div className="at-mv">{s.v}</div><div className="at-ml">{s.l}</div></div>
                ))}
              </div>
              <div>
                <div className="at-modal-section-title">About</div>
                <div style={{ fontSize: 13, color: "var(--gray-600)", lineHeight: 1.65 }}>{modalProfile.bio}</div>
              </div>
              <div>
                <div className="at-modal-section-title">Latest activity</div>
                <div className="at-recent-activity">
                  <div className="at-ra-head">
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--gray-900)" }}>Recent activity</div>
                    <div className="at-ra-sport-tag" style={parseStyleStr(modalProfile.activity.sportStyle)}>{modalProfile.activity.sport}</div>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--gray-600)" }}>{modalProfile.activity.desc}</div>
                  <div className="at-ra-stats">
                    {modalProfile.activity.stats.map((s, i) => <div key={i} className="at-ra-stat">{s}</div>)}
                  </div>
                  <div className="at-ra-ai">
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "var(--yellow)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontWeight: 700, color: "var(--gray-900)", flexShrink: 0, marginTop: 1 }}>AI</div>
                    <span>{modalProfile.activity.ai}</span>
                  </div>
                </div>
              </div>
              <div className="at-modal-footer-actions">
                <button className="at-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => showToast("Opening message…")}>💬 Message</button>
                <button className="at-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => showToast("Viewing full profile…")}>View full profile →</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={`at-toast${toastVisible ? " show" : ""}`}>{toast}</div>
    </div>
  );
}
