import { useCallback, useRef, useState, useEffect, memo } from 'react';
import { X, RotateCw } from 'lucide-react';

interface CanvasProtractorProps {
  visible: boolean;
  onClose: () => void;
  onRulerUpdate: (ruler: ProtractorLine | null) => void;
  containerRef: React.RefObject<HTMLDivElement>;
  zoom: number;
  pan: { x: number; y: number };
}

export interface ProtractorLine {
  /** Flat bottom edge start in world coords */
  x1: number; y1: number;
  /** Flat bottom edge end in world coords */
  x2: number; y2: number;
  nx: number; ny: number;
}

const PROTRACTOR_RADIUS = 120;
const PROTRACTOR_DIAMETER = PROTRACTOR_RADIUS * 2;
const SNAP_DISTANCE = 18;

export const snapToProtractor = (
  wx: number, wy: number,
  ruler: ProtractorLine | null,
  threshold: number = SNAP_DISTANCE
): { x: number; y: number; snapped: boolean } => {
  if (!ruler) return { x: wx, y: wy, snapped: false };
  const dx = ruler.x2 - ruler.x1;
  const dy = ruler.y2 - ruler.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: wx, y: wy, snapped: false };
  let t = ((wx - ruler.x1) * dx + (wy - ruler.y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const projX = ruler.x1 + t * dx;
  const projY = ruler.y1 + t * dy;
  const dist = Math.sqrt((wx - projX) ** 2 + (wy - projY) ** 2);
  if (dist < threshold) return { x: projX, y: projY, snapped: true };
  return { x: wx, y: wy, snapped: false };
};

export const CanvasProtractor = memo(({ visible, onClose, onRulerUpdate, containerRef, zoom, pan }: CanvasProtractorProps) => {
  const [position, setPosition] = useState({ x: 80, y: 260 });
  const [rotation, setRotation] = useState(0);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const rotateRef = useRef<{ startAngle: number; startRotation: number; cx: number; cy: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) { onRulerUpdate(null); return; }
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // Bottom flat edge (diameter line)
    const bx = position.x;
    const by = position.y + PROTRACTOR_RADIUS;
    const ex = position.x + PROTRACTOR_DIAMETER * cos;
    const ey = position.y + PROTRACTOR_RADIUS + PROTRACTOR_DIAMETER * sin;
    const x1 = (bx - pan.x) / zoom;
    const y1 = (by - pan.y) / zoom;
    const x2 = (ex - pan.x) / zoom;
    const y2 = (ey - pan.y) / zoom;
    const ldx = x2 - x1; const ldy = y2 - y1;
    const len = Math.sqrt(ldx * ldx + ldy * ldy);
    const nx = len > 0 ? -ldy / len : 0;
    const ny = len > 0 ? ldx / len : 0;
    onRulerUpdate({ x1, y1, x2, y2, nx, ny });
  }, [visible, position, rotation, zoom, pan, onRulerUpdate]);

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: position.x, startPosY: position.y };
  }, [position]);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (dragRef.current) {
      setPosition({
        x: dragRef.current.startPosX + e.clientX - dragRef.current.startX,
        y: dragRef.current.startPosY + e.clientY - dragRef.current.startY,
      });
    }
    if (rotateRef.current) {
      const angle = Math.atan2(e.clientY - rotateRef.current.cy, e.clientX - rotateRef.current.cx) * (180 / Math.PI);
      let newRot = rotateRef.current.startRotation + (angle - rotateRef.current.startAngle);
      const snaps = [0, 45, 90, 135, 180, -45, -90, -135, -180];
      for (const s of snaps) { if (Math.abs(newRot - s) < 3) { newRot = s; break; } }
      setRotation(newRot);
    }
  }, []);

  const handleDragEnd = useCallback(() => { dragRef.current = null; rotateRef.current = null; }, []);

  const handleRotateStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2; const cy = rect.top + rect.height / 2;
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
    rotateRef.current = { startAngle, startRotation: rotation, cx, cy };
  }, [rotation]);

  if (!visible) return null;

  // Generate degree tick marks for the semicircle
  const ticks: JSX.Element[] = [];
  for (let deg = 0; deg <= 180; deg++) {
    const rad = (deg * Math.PI) / 180;
    const is10 = deg % 10 === 0;
    const is5 = deg % 5 === 0;
    const outerR = PROTRACTOR_RADIUS - 2;
    const innerR = is10 ? PROTRACTOR_RADIUS - 20 : is5 ? PROTRACTOR_RADIUS - 14 : PROTRACTOR_RADIUS - 8;
    const cx = PROTRACTOR_RADIUS;
    const cy = PROTRACTOR_RADIUS;
    const x1 = cx + innerR * Math.cos(Math.PI - rad);
    const y1 = cy - innerR * Math.sin(Math.PI - rad);
    const x2 = cx + outerR * Math.cos(Math.PI - rad);
    const y2 = cy - outerR * Math.sin(Math.PI - rad);
    ticks.push(
      <line key={`t${deg}`} x1={x1} y1={y1} x2={x2} y2={y2}
        stroke="rgba(60,55,45,0.5)" strokeWidth={is10 ? 0.8 : 0.4} />
    );
    if (is10) {
      const labelR = PROTRACTOR_RADIUS - 26;
      const lx = cx + labelR * Math.cos(Math.PI - rad);
      const ly = cy - labelR * Math.sin(Math.PI - rad);
      ticks.push(
        <text key={`l${deg}`} x={lx} y={ly} textAnchor="middle" dominantBaseline="central"
          fontSize="7" fill="rgba(60,55,45,0.7)" fontFamily="system-ui">
          {deg}
        </text>
      );
    }
  }

  return (
    <div
      ref={ref}
      className="absolute z-30 select-none"
      style={{
        left: position.x,
        top: position.y,
        width: PROTRACTOR_DIAMETER,
        height: PROTRACTOR_RADIUS + 4,
        transform: `rotate(${rotation}deg)`,
        transformOrigin: '50% 100%',
        cursor: 'grab',
        touchAction: 'none',
      }}
      onPointerDown={handleDragStart}
      onPointerMove={handleDragMove}
      onPointerUp={handleDragEnd}
      onPointerCancel={handleDragEnd}
    >
      <svg width={PROTRACTOR_DIAMETER} height={PROTRACTOR_RADIUS + 4} className="absolute inset-0">
        {/* Semi-circle body */}
        <path
          d={`M 0 ${PROTRACTOR_RADIUS} A ${PROTRACTOR_RADIUS} ${PROTRACTOR_RADIUS} 0 0 1 ${PROTRACTOR_DIAMETER} ${PROTRACTOR_RADIUS} L 0 ${PROTRACTOR_RADIUS} Z`}
          fill="rgba(255,255,255,0.35)"
          stroke="rgba(180,175,160,0.4)"
          strokeWidth="1"
          style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.12))' }}
        />
        {/* Inner semi-circle cutout effect */}
        <path
          d={`M ${PROTRACTOR_RADIUS - 40} ${PROTRACTOR_RADIUS} A 40 40 0 0 1 ${PROTRACTOR_RADIUS + 40} ${PROTRACTOR_RADIUS} L ${PROTRACTOR_RADIUS - 40} ${PROTRACTOR_RADIUS} Z`}
          fill="rgba(255,255,255,0.15)"
          stroke="rgba(180,175,160,0.25)"
          strokeWidth="0.5"
        />
        {/* Top highlight */}
        <path
          d={`M 4 ${PROTRACTOR_RADIUS} A ${PROTRACTOR_RADIUS - 4} ${PROTRACTOR_RADIUS - 4} 0 0 1 ${PROTRACTOR_DIAMETER - 4} ${PROTRACTOR_RADIUS}`}
          fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2"
        />
        {/* Center dot */}
        <circle cx={PROTRACTOR_RADIUS} cy={PROTRACTOR_RADIUS} r="2.5" fill="rgba(59,130,246,0.7)" />
        {/* Cross hair */}
        <line x1={PROTRACTOR_RADIUS - 6} y1={PROTRACTOR_RADIUS} x2={PROTRACTOR_RADIUS + 6} y2={PROTRACTOR_RADIUS}
          stroke="rgba(59,130,246,0.5)" strokeWidth="0.7" />
        <line x1={PROTRACTOR_RADIUS} y1={PROTRACTOR_RADIUS - 6} x2={PROTRACTOR_RADIUS} y2={PROTRACTOR_RADIUS + 2}
          stroke="rgba(59,130,246,0.5)" strokeWidth="0.7" />
        {/* Bottom flat edge highlight */}
        <line x1="6" y1={PROTRACTOR_RADIUS} x2={PROTRACTOR_DIAMETER - 6} y2={PROTRACTOR_RADIUS}
          stroke="rgba(59,130,246,0.5)" strokeWidth="1.5" />
        {/* Degree ticks and labels */}
        {ticks}
      </svg>

      {/* Rotate handle */}
      <div
        className="absolute -right-5 top-1/2 w-5 h-5 rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing"
        style={{ background: 'rgba(59,130,246,0.8)', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}
        onPointerDown={handleRotateStart}
      >
        <RotateCw className="h-3 w-3 text-white" strokeWidth={2.5} />
      </div>

      {/* Close button */}
      <div
        className="absolute -right-1 -top-3 w-4 h-4 rounded-full flex items-center justify-center cursor-pointer"
        style={{ background: 'rgba(239,68,68,0.85)', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}
        onPointerDown={(e) => { e.stopPropagation(); onClose(); }}
      >
        <X className="h-2.5 w-2.5 text-white" strokeWidth={3} />
      </div>
    </div>
  );
});

CanvasProtractor.displayName = 'CanvasProtractor';
