import { useEffect, useState } from "react";
import {
  Button,
  Callout,
  Card,
  H1,
  HTMLTable,
  InputGroup,
  Intent,
  NonIdealState,
  ProgressBar,
  Spinner,
  Tag,
  Toaster,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { createItem, deleteItem, fetchItems, updateItem } from "./api";
import StatCard from "./components/StatCard";
import {
  NetworkCasePanel,
  OrbitCasePanel,
  RasterCasePanel,
} from "./components/SatelliteCasePanels";
import WorkItemDrawer, { emptyForm } from "./components/WorkItemDrawer";

const AppToaster = Toaster.create({
  position: "top",
});

const THEME_STORAGE_KEY = "pulse-desk:theme";

const statusMeta = {
  planned: { label: "Planned", intent: Intent.PRIMARY },
  active: { label: "Active", intent: Intent.SUCCESS },
  blocked: { label: "Blocked", intent: Intent.DANGER },
  done: { label: "Done", intent: Intent.NONE },
};

const priorityMeta = {
  low: { label: "Low", intent: Intent.NONE },
  medium: { label: "Medium", intent: Intent.WARNING },
  high: { label: "High", intent: Intent.PRIMARY },
  critical: { label: "Critical", intent: Intent.DANGER },
};

const tabMeta = [
  {
    id: "overview",
    label: "Overview",
    eyebrow: "TACTICAL OVERVIEW",
    title: "운영 지형을 한 눈에 조망한다.",
    description: "핵심 위험, 처리율, 담당자 부하를 요약해서 보여준다.",
    type: "ops",
  },
  {
    id: "operations",
    label: "Operations",
    eyebrow: "LIVE QUEUE",
    title: "작업 큐를 세밀하게 정렬하고 조작한다.",
    description: "검색, 상태 필터, 편집과 삭제까지 즉시 처리할 수 있다.",
    type: "ops",
  },
  {
    id: "blockers",
    label: "Blockers",
    eyebrow: "RISK SURFACE",
    title: "차단 이슈를 먼저 드러내고 해제 순서를 잡는다.",
    description: "긴급 항목을 별도 레인으로 모아 빠르게 대응한다.",
    type: "ops",
  },
  {
    id: "archive",
    label: "Archive",
    eyebrow: "CLOSED LOOP",
    title: "완료 항목과 처리 성과를 추적한다.",
    description: "누적 완료량과 최신 종료 항목을 점검할 수 있다.",
    type: "ops",
  },
  {
    id: "satellite-orbit",
    label: "Orbit Track",
    eyebrow: "CESIUM CASE",
    title: "한국 상업위성 추적",
    description: "SpaceEye-T + KOREASAT 관제 화면.",
    type: "satellite",
  },
  {
    id: "satellite-raster",
    label: "Raster Layer",
    eyebrow: "WORLDWIND CASE",
    title: "기상·대기·환경 래스터를 지구본 위에 오버레이한다.",
    description: "NASA WebWorldWind 스타일의 공공 데이터 분석 화면 샘플이다.",
    type: "satellite",
  },
  {
    id: "satellite-network",
    label: "Signal Mesh",
    eyebrow: "DECK.GL CASE",
    title: "위성 노드와 통신 Arc를 고밀도 네트워크로 표현한다.",
    description: "Deck.gl 계열 시각화에 맞춘 링크 밀도, 신호 강도, 경로 분포 샘플이다.",
    type: "satellite",
  },
];

const satelliteSidebarCounts = {
  "satellite-orbit": 12,
  "satellite-raster": 6,
  "satellite-network": 128,
};

function formatTimestamp(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function buildOwnerLoad(items) {
  const loadMap = new Map();

  for (const item of items) {
    const current = loadMap.get(item.owner) ?? { owner: item.owner, count: 0, critical: 0 };
    current.count += 1;
    if (item.priority === "critical") {
      current.critical += 1;
    }
    loadMap.set(item.owner, current);
  }

  return [...loadMap.values()].sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }

    return right.critical - left.critical;
  });
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") {
      return "dark";
    }

    return window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  });
  const [items, setItems] = useState([]);
  const [metrics, setMetrics] = useState({
    total: 0,
    planned: 0,
    active: 0,
    blocked: 0,
    done: 0,
  });
  const [activeTab, setActiveTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [drawerMode, setDrawerMode] = useState("closed");
  const [selectedItem, setSelectedItem] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const currentTab = tabMeta.find((tab) => tab.id === activeTab) ?? tabMeta[0];
  const isSatelliteTab = currentTab.type === "satellite";
  const isOperationsTab = activeTab === "operations";

  const activeQueryStatus =
    activeTab === "operations"
      ? statusFilter
      : activeTab === "blockers"
        ? "blocked"
        : activeTab === "archive"
          ? "done"
          : "all";

  const highlighted = items.find((item) => item.priority === "critical") || items[0] || null;
  const ownerLoad = buildOwnerLoad(items);
  const maxOwnerLoad = ownerLoad[0]?.count ?? 1;
  const completionRate = metrics.total ? Math.round((metrics.done / metrics.total) * 100) : 0;
  const activeShare = metrics.total ? Math.round((metrics.active / metrics.total) * 100) : 0;

  const topSignals = [
    {
      label: "Critical queue",
      value: `${metrics.blocked} item${metrics.blocked === 1 ? "" : "s"}`,
      tone: "danger",
      detail: "차단 이슈와 상위 우선순위를 즉시 노출한다.",
    },
    {
      label: "Live execution",
      value: `${metrics.active} item${metrics.active === 1 ? "" : "s"}`,
      tone: "success",
      detail: "현재 진행 중인 작업 비율을 지속적으로 확인한다.",
    },
    {
      label: "Closed loop",
      value: `${completionRate}%`,
      tone: "neutral",
      detail: "전체 작업 중 완료 항목 비율을 집계한다.",
    },
  ];

  const sidebarTabs = tabMeta.map((tab) => {
    if (tab.type === "satellite") {
      return { ...tab, count: satelliteSidebarCounts[tab.id] };
    }

    return {
      ...tab,
      count:
        tab.id === "overview"
          ? metrics.total
          : tab.id === "operations"
            ? metrics.active + metrics.planned
            : tab.id === "blockers"
              ? metrics.blocked
              : metrics.done,
    };
  });

  async function loadData(overrides = {}) {
    setLoading(true);
    setError("");

    try {
      const data = await fetchItems({
        search,
        status: activeQueryStatus,
        ...overrides,
      });
      setItems(data.items);
      setMetrics(data.metrics);
    } catch (fetchError) {
      setError(fetchError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData({ status: activeQueryStatus });
  }, [activeQueryStatus, search]);

  useEffect(() => {
    document.body.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  function closeDrawer() {
    setSelectedItem(null);
    setDrawerMode("closed");
    setForm(emptyForm);
  }

  function openCreateDrawer() {
    setDrawerMode("create");
    setSelectedItem(null);
    setForm(emptyForm);
  }

  function openEditDrawer(item) {
    setDrawerMode("edit");
    setSelectedItem(item);
    setForm({
      title: item.title,
      owner: item.owner,
      status: item.status,
      priority: item.priority,
      notes: item.notes || "",
    });
  }

  async function handleSubmit() {
    setSaving(true);

    try {
      if (drawerMode === "create") {
        await createItem(form);
        AppToaster.show({
          intent: Intent.SUCCESS,
          message: "항목이 추가됐다.",
          icon: IconNames.TICK,
        });
      } else {
        await updateItem(selectedItem.id, form);
        AppToaster.show({
          intent: Intent.SUCCESS,
          message: "항목이 업데이트됐다.",
          icon: IconNames.SAVED,
        });
      }

      closeDrawer();
      await loadData({ status: activeQueryStatus });
    } catch (submitError) {
      AppToaster.show({
        intent: Intent.DANGER,
        message: submitError.message,
        icon: IconNames.ERROR,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item) {
    const confirmed = window.confirm(`"${item.title}" 항목을 삭제할까?`);
    if (!confirmed) {
      return;
    }

    try {
      await deleteItem(item.id);
      AppToaster.show({
        intent: Intent.WARNING,
        message: "항목이 삭제됐다.",
        icon: IconNames.TRASH,
      });
      await loadData({ status: activeQueryStatus });
    } catch (deleteError) {
      AppToaster.show({
        intent: Intent.DANGER,
        message: deleteError.message,
        icon: IconNames.ERROR,
      });
    }
  }

  function renderTable(emptyTitle, emptyDescription, actionLabel = "새 항목 추가") {
    if (items.length === 0) {
      return (
        <NonIdealState
          icon={IconNames.DATABASE}
          title={emptyTitle}
          description={emptyDescription}
          action={
            <Button intent="primary" onClick={openCreateDrawer}>
              {actionLabel}
            </Button>
          }
        />
      );
    }

    return (
      <HTMLTable interactive striped className="work-table">
        <thead>
          <tr>
            <th>제목</th>
            <th>담당자</th>
            <th>상태</th>
            <th>우선순위</th>
            <th>업데이트</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <div className="title-cell">
                  <strong>{item.title}</strong>
                  <span>{item.notes || "메모 없음"}</span>
                </div>
              </td>
              <td>{item.owner}</td>
              <td>
                <Tag intent={statusMeta[item.status].intent} round>
                  {statusMeta[item.status].label}
                </Tag>
              </td>
              <td>
                <Tag intent={priorityMeta[item.priority].intent} minimal round>
                  {priorityMeta[item.priority].label}
                </Tag>
              </td>
              <td>{formatTimestamp(item.updated_at)}</td>
              <td>
                <div className="row-actions">
                  <Button small icon={IconNames.EDIT} onClick={() => openEditDrawer(item)}>
                    수정
                  </Button>
                  <Button
                    small
                    intent="danger"
                    icon={IconNames.TRASH}
                    onClick={() => handleDelete(item)}
                  >
                    삭제
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    );
  }

  function renderOverview() {
    return (
      <>
        <section className="stats-grid">
          <StatCard title="Total objects" value={metrics.total} intent="primary" subtitle="Tracked" />
          <StatCard title="Live execution" value={metrics.active} intent="success" subtitle="In motion" />
          <StatCard title="Blocked" value={metrics.blocked} intent="danger" subtitle="Escalate" />
          <StatCard title="Resolved" value={metrics.done} intent="none" subtitle="Closed" />
        </section>

        <section className="panel-grid panel-grid--hero">
          <Card className="panel panel--hero">
            <div className="panel__eyebrow">PRIMARY SIGNAL</div>
            <H1>{highlighted ? highlighted.title : "표시할 항목이 없다."}</H1>
            <p className="hero-copy">
              {highlighted
                ? highlighted.notes || "세부 메모가 아직 기록되지 않았다."
                : "좌측 탭과 우측 패널을 기반으로 운영 구조와 위성 시각화 케이스를 함께 확장할 수 있다."}
            </p>
            <div className="hero-meta">
              <div className="hero-chip">
                <span>Status</span>
                <Tag intent={highlighted ? statusMeta[highlighted.status].intent : Intent.NONE} round>
                  {highlighted ? statusMeta[highlighted.status].label : "None"}
                </Tag>
              </div>
              <div className="hero-chip">
                <span>Priority</span>
                <Tag
                  intent={highlighted ? priorityMeta[highlighted.priority].intent : Intent.NONE}
                  minimal
                  round
                >
                  {highlighted ? priorityMeta[highlighted.priority].label : "N/A"}
                </Tag>
              </div>
              <div className="hero-chip">
                <span>Owner</span>
                <strong>{highlighted ? highlighted.owner : "Unassigned"}</strong>
              </div>
            </div>
            <div className="progress-block">
              <div className="progress-block__header">
                <span>Completion ratio</span>
                <strong>{completionRate}%</strong>
              </div>
              <ProgressBar value={completionRate / 100} intent={Intent.PRIMARY} />
            </div>
          </Card>

          <Card className="panel">
            <div className="panel-header">
              <div>
                <div className="panel__eyebrow">SIGNAL STACK</div>
                <strong>Current operational posture</strong>
              </div>
              <Tag minimal>Live</Tag>
            </div>
            <div className="signal-list">
              {topSignals.map((signal) => (
                <div key={signal.label} className={`signal-row signal-row--${signal.tone}`}>
                  <div>
                    <span>{signal.label}</span>
                    <strong>{signal.value}</strong>
                  </div>
                  <p>{signal.detail}</p>
                </div>
              ))}
            </div>
            <Callout intent={Intent.PRIMARY} title="Execution share">
              현재 진행 중인 항목은 전체의 {activeShare}%다. 아래 탭 3개는 위성정보를 출력하는 대표
              시나리오 샘플로 추가해 두었다.
            </Callout>
          </Card>
        </section>

        <section className="panel-grid">
          <Card className="panel">
            <div className="panel-header">
              <div>
                <div className="panel__eyebrow">QUEUE SNAPSHOT</div>
                <strong>Priority queue</strong>
              </div>
              <Tag minimal>Top 4</Tag>
            </div>
            <div className="list-stack">
              {items.slice(0, 4).map((item) => (
                <button key={item.id} className="list-row" onClick={() => openEditDrawer(item)}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.owner}</span>
                  </div>
                  <div className="list-row__meta">
                    <Tag intent={priorityMeta[item.priority].intent} minimal round>
                      {priorityMeta[item.priority].label}
                    </Tag>
                    <small>{formatTimestamp(item.updated_at)}</small>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <Card className="panel">
            <div className="panel-header">
              <div>
                <div className="panel__eyebrow">ALLOCATION</div>
                <strong>Owner load</strong>
              </div>
              <Tag minimal>{ownerLoad.length} owner(s)</Tag>
            </div>
            <div className="owner-list">
              {ownerLoad.length === 0 ? (
                <p className="empty-copy">표시할 담당자 부하 데이터가 없다.</p>
              ) : (
                ownerLoad.map((entry) => (
                  <div key={entry.owner} className="owner-row">
                    <div className="owner-row__header">
                      <strong>{entry.owner}</strong>
                      <span>
                        {entry.count} item{entry.count === 1 ? "" : "s"}
                      </span>
                    </div>
                    <ProgressBar
                      value={entry.count / maxOwnerLoad}
                      intent={entry.critical > 0 ? Intent.DANGER : Intent.PRIMARY}
                    />
                  </div>
                ))
              )}
            </div>
          </Card>
        </section>
      </>
    );
  }

  function renderOperations() {
    return (
      <>
        <section className="panel control-panel">
          <div className="panel-header">
            <div>
              <div className="panel__eyebrow">STATUS FILTER</div>
              <strong>Operational queue selector</strong>
            </div>
            <Tag minimal>{statusFilter === "all" ? "All states" : statusMeta[statusFilter].label}</Tag>
          </div>
          <div className="segment-filter">
            {["all", "planned", "active", "blocked", "done"].map((value) => (
              <Button
                key={value}
                active={statusFilter === value}
                minimal={statusFilter !== value}
                onClick={() => setStatusFilter(value)}
              >
                {value === "all" ? "All" : statusMeta[value].label}
              </Button>
            ))}
          </div>
        </section>

        <section className="panel-grid">
          <Card className="panel panel--table">
            <div className="panel-header">
              <div>
                <div className="panel__eyebrow">LIVE TABLE</div>
                <strong>Operational work queue</strong>
              </div>
              <Tag minimal>{items.length} visible</Tag>
            </div>
            {renderTable(
              "조건에 맞는 항목이 없다.",
              "검색어나 상태 필터를 바꾸거나 새 항목을 추가하면 된다.",
            )}
          </Card>

          <Card className="panel">
            <div className="panel-header">
              <div>
                <div className="panel__eyebrow">WORKLOAD TRACE</div>
                <strong>Current roster</strong>
              </div>
              <Tag minimal>Filtered</Tag>
            </div>
            <div className="owner-list">
              {ownerLoad.length === 0 ? (
                <p className="empty-copy">현재 필터에 해당하는 담당자가 없다.</p>
              ) : (
                ownerLoad.map((entry) => (
                  <div key={entry.owner} className="roster-card">
                    <div>
                      <strong>{entry.owner}</strong>
                      <span>{entry.count} items assigned</span>
                    </div>
                    <Tag intent={entry.critical > 0 ? Intent.DANGER : Intent.PRIMARY} round>
                      {entry.critical > 0 ? `${entry.critical} critical` : "Nominal"}
                    </Tag>
                  </div>
                ))
              )}
            </div>
          </Card>
        </section>
      </>
    );
  }

  function renderBlockers() {
    return (
      <section className="panel-grid">
        <Card className="panel panel--alert-surface">
          <div className="panel-header">
            <div>
              <div className="panel__eyebrow">ESCALATION QUEUE</div>
              <strong>Blocked items</strong>
            </div>
            <Tag intent={Intent.DANGER} minimal>
              {items.length} active blockers
            </Tag>
          </div>

          {items.length === 0 ? (
            <NonIdealState
              icon={IconNames.TICK}
              title="현재 차단 이슈가 없다."
              description="모든 차단 항목이 해제됐거나 아직 입력되지 않았다."
            />
          ) : (
            <div className="alert-stack">
              {items.map((item) => (
                <article key={item.id} className="alert-card">
                  <div className="alert-card__header">
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.owner}</span>
                    </div>
                    <Tag intent={priorityMeta[item.priority].intent} round>
                      {priorityMeta[item.priority].label}
                    </Tag>
                  </div>
                  <p>{item.notes || "세부 메모 없음"}</p>
                  <div className="alert-card__footer">
                    <small>Updated {formatTimestamp(item.updated_at)}</small>
                    <Button small icon={IconNames.EDIT} onClick={() => openEditDrawer(item)}>
                      열기
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Card>

        <Card className="panel">
          <div className="panel-header">
            <div>
              <div className="panel__eyebrow">RECOVERY PROTOCOL</div>
              <strong>Recommended response order</strong>
            </div>
            <Tag minimal>Static playbook</Tag>
          </div>
          <div className="protocol-list">
            <div className="protocol-step">
              <strong>01</strong>
              <p>영향 범위를 먼저 고정하고 재현 가능한 입력 세트를 확보한다.</p>
            </div>
            <div className="protocol-step">
              <strong>02</strong>
              <p>소유자를 명시하고 외부 의존성, 로그, 타임라인을 한 패널에 모은다.</p>
            </div>
            <div className="protocol-step">
              <strong>03</strong>
              <p>해제 조건을 수치로 정의하고 완료 후 즉시 아카이브 탭으로 이동시킨다.</p>
            </div>
          </div>
          <Callout intent={Intent.DANGER} title="Escalation pressure">
            차단 항목은 일반 작업과 같은 큐에 두지 말고, 별도 레인으로 분리해 우선순위를 명확히
            유지하는 편이 낫다.
          </Callout>
        </Card>
      </section>
    );
  }

  function renderArchive() {
    return (
      <section className="panel-grid">
        <Card className="panel">
          <div className="panel-header">
            <div>
              <div className="panel__eyebrow">CLOSURE METRICS</div>
              <strong>Completion telemetry</strong>
            </div>
            <Tag minimal>{completionRate}% closed</Tag>
          </div>
          <div className="archive-metrics">
            <div className="archive-metric">
              <span>Done items</span>
              <strong>{metrics.done}</strong>
            </div>
            <div className="archive-metric">
              <span>Open items</span>
              <strong>{metrics.total - metrics.done}</strong>
            </div>
          </div>
          <ProgressBar value={completionRate / 100} intent={Intent.SUCCESS} />
          <p className="archive-copy">
            종료 항목은 따로 분리해서 회고와 처리 속도 분석에 사용할 수 있게 구성했다.
          </p>
        </Card>

        <Card className="panel panel--table">
          <div className="panel-header">
            <div>
              <div className="panel__eyebrow">CLOSED RECORD</div>
              <strong>Resolved items</strong>
            </div>
            <Tag minimal>{items.length} visible</Tag>
          </div>
          {renderTable(
            "완료 항목이 없다.",
            "완료 처리된 작업이 생기면 이 탭에서 누적 상태를 볼 수 있다.",
            "새 항목 만들기",
          )}
        </Card>
      </section>
    );
  }

  function renderHeaderActions() {
    const themeToggle = (
      <div className="theme-toggle" role="group" aria-label="Theme mode">
        <Button
          active={theme === "dark"}
          minimal={theme !== "dark"}
          icon={IconNames.MOON}
          onClick={() => setTheme("dark")}
        >
          Dark
        </Button>
        <Button
          active={theme === "light"}
          minimal={theme !== "light"}
          icon={IconNames.FLASH}
          onClick={() => setTheme("light")}
        >
          Light
        </Button>
      </div>
    );

    if (isSatelliteTab) {
      return (
        <div className="stage-header__actions stage-header__actions--compact">
          {themeToggle}
          <Button icon={IconNames.DUPLICATE} onClick={() => setSearch("")}>
            샘플 리셋
          </Button>
          <Button icon={IconNames.ADD} intent="primary" onClick={openCreateDrawer}>
            운영 항목 추가
          </Button>
        </div>
      );
    }

    return (
      <div className="stage-header__actions">
        {themeToggle}
        <InputGroup
          leftIcon={IconNames.SEARCH}
          large
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="제목, 담당자, 메모 검색"
        />
        <Button icon={IconNames.ADD} intent="primary" large onClick={openCreateDrawer}>
          새 항목
        </Button>
      </div>
    );
  }

  function renderContent() {
    if (loading && currentTab.type === "ops") {
      return (
        <Card className="panel panel--loading">
          <div className="loading-state">
            <Spinner />
          </div>
        </Card>
      );
    }

    if (activeTab === "overview") {
      return renderOverview();
    }

    if (activeTab === "operations") {
      return renderOperations();
    }

    if (activeTab === "blockers") {
      return renderBlockers();
    }

    if (activeTab === "archive") {
      return renderArchive();
    }

    if (activeTab === "satellite-orbit") {
      return <OrbitCasePanel />;
    }

    if (activeTab === "satellite-raster") {
      return <RasterCasePanel />;
    }

    return <NetworkCasePanel />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="sidebar__mark" />
          <div>
            <strong>Pulse Desk</strong>
            <span>Operations Lattice</span>
          </div>
        </div>

        <div className="sidebar__section-label">Navigation</div>
        <nav className="sidebar__nav">
          {sidebarTabs.map((tab) => (
            <button
              key={tab.id}
              className={`sidebar-tab ${activeTab === tab.id ? "sidebar-tab--active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <div className="sidebar-tab__copy">
                <strong>{tab.label}</strong>
                <span>{tab.eyebrow}</span>
              </div>
              <div className="sidebar-tab__count">{tab.count}</div>
            </button>
          ))}
        </nav>

        <Card className="sidebar-card">
          <div className="panel__eyebrow">SYSTEM STATE</div>
          <div className="sidebar-card__row">
            <span>Data source</span>
            <strong>SQLite</strong>
          </div>
          <div className="sidebar-card__row">
            <span>Stack</span>
            <strong>{isSatelliteTab ? "Sample Viz" : "BlueprintJS"}</strong>
          </div>
          <div className="sidebar-card__row">
            <span>Objects</span>
            <strong>{metrics.total}</strong>
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

        {error ? (
          <Callout intent={Intent.DANGER} title="데이터를 불러오지 못했다.">
            {error}
          </Callout>
        ) : null}

        {isSatelliteTab ? (
          <Callout className="case-callout" intent={Intent.PRIMARY} title="문서 기반 분류">
            `3d 글로브 구현.md` 기준으로 `위성 궤도`, `래스터 오버레이`, `통신 Arc/히트맵`의 3가지
            케이스를 각각 별도 화면으로 구현했다.
          </Callout>
        ) : null}

        {isOperationsTab ? (
          <Callout className="case-callout" intent={Intent.NONE} title="참고">
            좌측의 `Orbit Track`, `Raster Layer`, `Signal Mesh` 탭에서 위성정보 출력 샘플 3가지를 볼 수
            있다.
          </Callout>
        ) : null}

        <section className="stage-content">{renderContent()}</section>
      </main>

      <WorkItemDrawer
        isOpen={drawerMode === "create" || drawerMode === "edit"}
        mode={drawerMode}
        value={form}
        saving={saving}
        onChange={(field, nextValue) =>
          setForm((current) => ({
            ...current,
            [field]: nextValue,
          }))
        }
        onClose={closeDrawer}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
