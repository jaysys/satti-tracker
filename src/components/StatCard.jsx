import { Card, H5, Tag } from "@blueprintjs/core";

export default function StatCard({ title, value, intent, subtitle }) {
  return (
    <Card className="stat-card" data-intent={intent} elevation={0}>
      <div className="stat-card__header">
        <H5>{title}</H5>
        <Tag intent={intent} minimal round>
          {subtitle}
        </Tag>
      </div>
      <div className="stat-card__value">{value}</div>
    </Card>
  );
}
