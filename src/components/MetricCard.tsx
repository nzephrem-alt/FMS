
import { ArrowUpRight, ArrowDownRight, type LucideIcon } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string | number;
  note: string;
  positive?: boolean;
  icon: LucideIcon;
  tone: string;
}

function MetricCard({
  label,
  value,
  note,
  positive = false,
  icon: Icon,
  tone,
}: MetricCardProps) {
  return (
    <div className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <div className={`metric-icon ${tone}`}>
          <Icon size={18} />
        </div>
      </div>

      <div className="metric-value">{value}</div>

      <div className={`metric-note ${positive ? 'positive' : 'neutral'}`}>
        {positive ? (
          <ArrowUpRight size={14} />
        ) : (
          <ArrowDownRight size={14} />
        )}
        <span>{note}</span>
      </div>
    </div>
  );
}

export default MetricCard;
