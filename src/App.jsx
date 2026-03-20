import { useEffect, useState } from "react";
import { Button, Callout, Card, H1, Icon } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import {
  CatalogSummaryPanel,
  NetworkCasePanel,
  OrbitCasePanel,
  RasterCasePanel,
} from "./components/SatelliteCasePanels";

const THEME_STORAGE_KEY = "pulse-desk:theme";

const tabMeta = [
  {
    id: "satellite-orbit",
    label: "Orbit Track",
    eyebrow: "K-Sattie Case",
    title: "한국 위성 궤도 추적",
    description: "한국 위성의 현재 위치와 궤도선을 3D 지구본에서 추적한다.",
    count: 12,
    icon: IconNames.SATELLITE,
  },
  {
    id: "satellite-catalog",
    label: "Satellite Table",
    eyebrow: "CSV CASE",
    title: "대한민국 위성 payload 카탈로그",
    description: "CSV 원본 55행을 읽기 쉬운 표와 요약 카드로 정리한다.",
    count: 55,
    icon: IconNames.TH,
  },
  {
    id: "satellite-raster",
    label: "Raster Layer",
    eyebrow: "WORLDWIND CASE",
    title: "래스터 오버레이 레이어",
    description: "기상·대기·환경 래스터 데이터를 지구본 위에 중첩하는 화면이다.",
    count: 6,
    icon: IconNames.GLOBE,
  },
  {
    id: "satellite-network",
    label: "Signal Mesh",
    eyebrow: "DECK.GL CASE",
    title: "위성 통신 링크 네트워크",
    description: "위성 노드와 링크 분포를 네트워크 레이어로 시각화한다.",
    count: 128,
    icon: IconNames.GLOBE_NETWORK,
  },
];

export default function App() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") {
      return "dark";
    }

    return window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  });
  const [activeTab, setActiveTab] = useState("satellite-orbit");

  const currentTab = tabMeta.find((tab) => tab.id === activeTab) ?? tabMeta[0];

  useEffect(() => {
    document.body.dataset.theme = theme;
    document.body.classList.toggle("bp5-dark", theme === "dark");
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  function renderHeaderActions() {
    return (
      <div className="stage-header__actions stage-header__actions--compact">
        <Button
          className="theme-toggle__button"
          icon={theme === "dark" ? IconNames.FLASH : IconNames.MOON}
          onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        >
          {theme === "dark" ? "라이트 모드" : "다크 모드"}
        </Button>
      </div>
    );
  }

  function renderContent() {
    if (activeTab === "satellite-orbit") {
      return <OrbitCasePanel />;
    }

    if (activeTab === "satellite-raster") {
      return <RasterCasePanel />;
    }

    if (activeTab === "satellite-catalog") {
      return <CatalogSummaryPanel />;
    }

    return <NetworkCasePanel />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="sidebar__mark" aria-hidden="true">
            <Icon icon={IconNames.SATELLITE} size={18} />
          </div>
          <div>
            <strong>K-Sattie Orbital Atlas</strong>
            <span>Korean Satellite Visualization</span>
          </div>
        </div>

        <div className="sidebar__section-label">Navigation</div>
        <nav className="sidebar__nav">
          {tabMeta.map((tab) => (
            <button
              key={tab.id}
              className={`sidebar-tab ${activeTab === tab.id ? "sidebar-tab--active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <div className="sidebar-tab__main">
                <div className="sidebar-tab__icon" aria-hidden="true">
                  <Icon icon={tab.icon} size={16} />
                </div>
                <div className="sidebar-tab__copy">
                  <strong>{tab.label}</strong>
                  <span>{tab.eyebrow}</span>
                </div>
              </div>
              <div className="sidebar-tab__count">{tab.count}</div>
            </button>
          ))}
        </nav>

        <Card className="sidebar-card">
          <div className="panel__eyebrow">SYSTEM STATE</div>
          <div className="sidebar-card__row">
            <span>Mode</span>
            <strong>Satellite only</strong>
          </div>
          <div className="sidebar-card__row">
            <span>Visible tabs</span>
            <strong>4</strong>
          </div>
          <div className="sidebar-card__row">
            <span>Stack</span>
            <strong>Cesium · WWD · deck.gl</strong>
          </div>
        </Card>
      </aside>

      <main className="command-stage">
        <header className="stage-header">
          <div>
            <div className="stage-header__eyebrow">{currentTab.eyebrow}</div>
            <H1>{currentTab.title}</H1>
            <p>{currentTab.description}</p>
          </div>
          {renderHeaderActions()}
        </header>

        <Callout className="case-callout" intent="primary" title="Satellite visualization cases">
          `Orbit Track`, `Satellite Table`, `Raster Layer`, `Signal Mesh` 4개 케이스만 남기고 나머지 운영
          대시보드 기능과 화면은 제거했다.
        </Callout>

        <section className="stage-content">{renderContent()}</section>
      </main>
    </div>
  );
}
