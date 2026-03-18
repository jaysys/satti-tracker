import {
  Button,
  Classes,
  DialogBody,
  DialogFooter,
  Drawer,
  FormGroup,
  HTMLSelect,
  InputGroup,
  TextArea,
} from "@blueprintjs/core";

const statusOptions = [
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
];

const priorityOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export const emptyForm = {
  title: "",
  owner: "",
  status: "planned",
  priority: "medium",
  notes: "",
};

export default function WorkItemDrawer({
  isOpen,
  mode,
  value,
  saving,
  onChange,
  onClose,
  onSubmit,
}) {
  return (
    <Drawer
      className="work-item-drawer"
      isOpen={isOpen}
      onClose={onClose}
      title={mode === "create" ? "새 항목 추가" : "항목 수정"}
      position="right"
      size="480px"
    >
      <DialogBody useOverflowScrollContainer>
        <div className={Classes.DIALOG_BODY}>
          <FormGroup label="제목" labelFor="title" labelInfo="(필수)">
            <InputGroup
              id="title"
              value={value.title}
              onChange={(event) => onChange("title", event.target.value)}
              placeholder="예: SLA 모니터링 알림 정리"
            />
          </FormGroup>
          <FormGroup label="담당자" labelFor="owner" labelInfo="(필수)">
            <InputGroup
              id="owner"
              value={value.owner}
              onChange={(event) => onChange("owner", event.target.value)}
              placeholder="예: Jaeho"
            />
          </FormGroup>
          <div className="drawer-grid">
            <FormGroup label="상태" labelFor="status">
              <HTMLSelect
                id="status"
                fill
                value={value.status}
                onChange={(event) => onChange("status", event.target.value)}
                options={statusOptions}
              />
            </FormGroup>
            <FormGroup label="우선순위" labelFor="priority">
              <HTMLSelect
                id="priority"
                fill
                value={value.priority}
                onChange={(event) => onChange("priority", event.target.value)}
                options={priorityOptions}
              />
            </FormGroup>
          </div>
          <FormGroup label="메모" labelFor="notes">
            <TextArea
              id="notes"
              fill
              growVertically
              large
              value={value.notes}
              onChange={(event) => onChange("notes", event.target.value)}
              placeholder="운영 배경, 의존성, 이슈 등을 적는다."
            />
          </FormGroup>
        </div>
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button onClick={onClose}>취소</Button>
            <Button intent="primary" loading={saving} onClick={onSubmit}>
              {mode === "create" ? "저장" : "업데이트"}
            </Button>
          </>
        }
      />
    </Drawer>
  );
}
