import { useState, useRef, useEffect } from "react";

type Message = {
  role: "user" | "ai";
  content: string;
};

type ActivityData = {
  id: string;
  sport: string;
  athlete: string;
  stats: Record<string, string>;
  note: string;
  quickPrompts: string[];
  avatar: { bg: string; color: string; initials: string };
  headerUser: string;
  sportEmoji: string;
  timeLoc: string;
  body: string;
  kudos: number;
  comments: number;
  routeLabel: string;
};

const mockAnalysisData: Record<string, { summary: string; insights: {label: string, value: string, note: string, type: string}[]; recommendations: string[] }> = {
  "1": {
    summary: "Solid endurance run, but signs of fatigue starting at mile 8 suggest glycogen depletion or poor pacing early on.",
    insights: [
      { label: "Pacing", value: "-15s/km", note: "Drop in pace miles 8-10", type: "warn" },
      { label: "Heart Rate", value: "148 bpm", note: "Good Zone 3 tempo", type: "good" },
      { label: "Elevation", value: "+312m", note: "Mostly front-loaded", type: "info" }
    ],
    recommendations: [
      "For your PB attempt next Sunday, ensure you are carb-loading properly 48 hours prior.",
      "Try to run negative splits—start 5-10 seconds slower than target pace for the first 3km."
    ]
  },
  "2": {
    summary: "Great job sending the project! A 2h 10m session with a successful V7 send indicates good power endurance.",
    insights: [
      { label: "Persistence", value: "3 weeks", note: "Good macro-projecting", type: "good" },
      { label: "Session", value: "2h 10m", note: "Optimal length", type: "good" },
      { label: "Crux", value: "Undercling", note: "Demands bicep/core", type: "info" }
    ],
    recommendations: [
      "Take at least 48 hours of active recovery before your next hard bouldering session.",
      "Consider working on V8s with similar undercling/compression styles to build on this strength."
    ]
  },
  "3": {
    summary: "Strong output on a challenging climbing route. 241W average over nearly 3 hours is a solid endurance effort.",
    insights: [
      { label: "Power", value: "241W", note: "Solid aerobic base", type: "good" },
      { label: "Pacing", value: "Consistent", note: "Even output", type: "good" },
      { label: "Elevation", value: "1,240m", note: "Sustained climbing", type: "info" }
    ],
    recommendations: [
      "Focus on nutrition—ensure you are taking in 60-90g of carbs per hour on these long climbs.",
      "Include some sweet spot intervals (2x20 mins at 90% FTP) in your mid-week rides to prep for the Stelvio."
    ]
  }
};

export default function ActivityCard({ data }: { data: ActivityData }) {
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [kudosCount, setKudosCount] = useState(data.kudos);
  
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTab, setAiTab] = useState<"analysis" | "chat">("analysis");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisLoaded, setAnalysisLoaded] = useState(false);
  
  const [chatMessages, setChatMessages] = useState<Message[]>([
    { role: "ai", content: `Hi! I've analysed ${data.athlete}'s ${data.sport.toLowerCase()} session. Ask me anything about the workout, training approach, or how to improve.` }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const chatHistoryRef = useRef<HTMLDivElement>(null);

  const handleKudos = () => {
    if (liked) {
      setLiked(false);
      setKudosCount(kudosCount - 1);
    } else {
      setLiked(true);
      setKudosCount(kudosCount + 1);
    }
  };

  const handleToggleAI = () => {
    if (!aiOpen && !analysisLoaded) {
      setAiOpen(true);
      setAnalysisLoading(true);
      setTimeout(() => {
        setAnalysisLoading(false);
        setAnalysisLoaded(true);
      }, 1500);
    } else {
      setAiOpen(!aiOpen);
    }
  };

  const handleSendChat = (text: string) => {
    if (!text.trim()) return;
    const msg = text.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: msg }]);
    setIsTyping(true);

    setTimeout(() => {
      setIsTyping(false);
      setChatMessages((prev) => [...prev, { role: "ai", content: `As an AI coach, based on the ${data.sport} data, I recommend focusing on consistent pacing and proper recovery. Keep up the good work!` }]);
    }, 1000);
  };

  useEffect(() => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [chatMessages, isTyping]);

  const currentAnalysis = mockAnalysisData[data.id];

  return (
    <div className="activity-card" id={`card-${data.id}`}>
      <div className="activity-card-body">
        <div className="act-header">
          <div className="act-avatar" style={{ background: data.avatar.bg, color: data.avatar.color }}>{data.avatar.initials}</div>
          <div className="act-meta">
            <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
              <div className="act-user">{data.headerUser}</div>
              <span className="tag sport" style={{ fontSize: "10px" }}>{data.sportEmoji} {data.sport}</span>
            </div>
            <div className="act-time">{data.timeLoc}</div>
          </div>
        </div>
        <div className="act-stats">
          {Object.entries(data.stats).map(([val, lbl], idx) => (
            <div className="act-stat-pill" key={idx}>
              <div className="val">{val}</div>
              <div className="lbl">{lbl}</div>
            </div>
          ))}
        </div>
        <div className="act-body">{data.body}</div>
        <div className="act-actions">
          <button className={`act-btn ${liked ? "liked" : ""}`} onClick={handleKudos} data-testid={`btn-kudos-${data.id}`}>
            👍 {kudosCount} kudos
          </button>
          <button className="act-btn" data-testid={`btn-comments-${data.id}`}>💬 {data.comments} comments</button>
          <button className="act-btn" onClick={() => setSaved(!saved)} data-testid={`btn-save-${data.id}`}>
            {data.routeLabel === "Save" ? (saved ? "🔖 Saved" : "🔖 Save") : "📍 " + data.routeLabel}
          </button>
          <button className={`act-btn ai-btn ${aiOpen ? "active" : ""}`} onClick={handleToggleAI} data-testid={`btn-ai-${data.id}`}>
            ✦ AI Coach
          </button>
        </div>
      </div>

      <div className={`ai-panel ${aiOpen ? "open" : ""}`} id={`ai-panel-${data.id}`}>
        <div className="ai-panel-tabs">
          <div className={`ai-tab ${aiTab === "analysis" ? "active" : ""}`} onClick={() => setAiTab("analysis")} data-testid={`tab-analysis-${data.id}`}>Analysis</div>
          <div className={`ai-tab ${aiTab === "chat" ? "active" : ""}`} onClick={() => setAiTab("chat")} data-testid={`tab-chat-${data.id}`}>Ask the coach</div>
        </div>
        <div className="ai-panel-content">
          {aiTab === "analysis" && (
            <div>
              {analysisLoading ? (
                <div className="ai-loading">
                  <div className="ai-spinner"></div>
                  Analysing your {data.sport.toLowerCase()} data…
                </div>
              ) : analysisLoaded && currentAnalysis ? (
                <div className="ai-response">
                  <h4>Performance Summary</h4>
                  <p>{currentAnalysis.summary}</p>
                  
                  <h4>Key Insights</h4>
                  <div className="insight-cards">
                    {currentAnalysis.insights.map((insight, idx) => (
                      <div className={`insight-card ${insight.type}`} key={idx}>
                        <div className="ic-label">{insight.label}</div>
                        <div className="ic-value">{insight.value}</div>
                        <div className="ic-note">{insight.note}</div>
                      </div>
                    ))}
                  </div>
                  
                  <h4>Training Recommendations</h4>
                  {currentAnalysis.recommendations.map((rec, idx) => (
                    <p key={idx}>{rec}</p>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {aiTab === "chat" && (
            <div>
              <div className="ai-chat-history" ref={chatHistoryRef}>
                {chatMessages.map((msg, idx) => (
                  <div className={`chat-msg ${msg.role === "user" ? "user" : "ai"}`} key={idx}>
                    <div className={`chat-icon ${msg.role === "user" ? "user-icon" : "ai-icon"}`}>
                      {msg.role === "user" ? "JK" : "AI"}
                    </div>
                    <div className="chat-bubble">{msg.content}</div>
                  </div>
                ))}
                {isTyping && (
                  <div className="chat-msg ai">
                    <div className="chat-icon ai-icon">AI</div>
                    <div className="chat-bubble ai-loading" style={{ padding: "8px 12px" }}>
                      <div className="ai-spinner"></div>
                    </div>
                  </div>
                )}
              </div>
              
              {chatMessages.length === 1 && (
                <div className="quick-prompts">
                  {data.quickPrompts.map((q, idx) => (
                    <div className="quick-prompt" key={idx} onClick={() => handleSendChat(q)} data-testid={`btn-quickprompt-${idx}`}>
                      {q}
                    </div>
                  ))}
                </div>
              )}

              <div className="ai-chat-input-row">
                <input
                  className="ai-chat-input"
                  placeholder="Ask the AI coach anything…"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSendChat(chatInput);
                  }}
                  data-testid={`input-chat-${data.id}`}
                />
                <button
                  className="ai-send-btn"
                  onClick={() => handleSendChat(chatInput)}
                  disabled={!chatInput.trim() || isTyping}
                  data-testid={`btn-sendchat-${data.id}`}
                >
                  Send ↑
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
