import { useState } from "react";

export default function TabsBar() {
  const [activeTab, setActiveTab] = useState("Activities");

  const tabs = [
    { name: "Activities", count: "312k" },
    { name: "Athletes", count: "84k" },
    { name: "Groups", count: "6.4k" },
    { name: "Events", count: "2.1k" },
    { name: "Challenges", count: "340" },
  ];

  return (
    <div className="tabs-bar">
      <div className="tabs-inner">
        {tabs.map((tab) => (
          <div
            key={tab.name}
            className={`tab ${activeTab === tab.name ? "active" : ""}`}
            onClick={() => setActiveTab(tab.name)}
            data-testid={`tab-${tab.name.toLowerCase()}`}
          >
            {tab.name} <span className="count">{tab.count}</span>
          </div>
        ))}
        <div className="tab-spacer"></div>
        <select className="sort-select" data-testid="select-sort">
          <option>Sort: Most recent</option>
          <option>Most liked</option>
          <option>Trending</option>
        </select>
      </div>
    </div>
  );
}
