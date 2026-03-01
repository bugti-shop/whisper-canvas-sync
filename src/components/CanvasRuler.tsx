import { useCallback, useRef, useState, useEffect, memo } from 'react';
import { X, RotateCw } from 'lucide-react';

interface CanvasRulerProps {
  visible: boolean;
  onClose: () => void;
  /** Returns the ruler's edge line in world coords for snapping */
  onRulerUpdate: (ruler: RulerLine | null) => void;
  containerRef: React.RefObject<HTMLDivElement>;
  zoomRef: React.RefObject<number>;
  panRef: React.RefObject<{ x: number; y: number }>;
  /** State value that changes on zoom/pan to trigger re-computation */
  zoomDisplay: number;
}

export interface RulerLine {
  /** Start point of the ruler bottom edge in world coords */
  x1: number; y1: number;
  /** End point of the ruler bottom edge in world coords */
  x2: number; y2: number;
  /** Unit normal pointing into the canvas (away from ruler body) */
  nx: number; ny: number;
}

const RULER_WIDTH = 340;
const RULER_HEIGHT = 52;
const SNAP_DISTANCE = 18; // pixels from edge to snap

/** Snap a world-coordinate point to the ruler edge if close enough */
export const snapToRuler = (
  wx: number, wy: number,
  ruler: RulerLine | null,
  threshold: number = SNAP_DISTANCE
): { x: number; y: number; snapped: boolean } => {
  if (!ruler) return { x: wx, y: wy, snapped: false };
  
  const dx = ruler.x2 - ruler.x1;
  const dy = ruler.y2 - ruler.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: wx, y: wy, snapped: false };
  
  // Project point onto the line
  let t = ((wx - ruler.x1) * dx + (wy - ruler.y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  
  const projX = ruler.x1 + t * dx;
  const projY = ruler.y1 + t * dy;
  
  const dist = Math.sqrt((wx - projX) ** 2 + (wy - projY) ** 2);
  
  if (dist < threshold) {
    return { x: projX, y: projY, snapped: true };
  }
  return { x: wx, y: wy, snapped: false };
};

export const CanvasRuler = memo(({ visible, onClose, onRulerUpdate, containerRef, zoomRef, panRef, zoomDisplay }: CanvasRulerProps) => {
  const [position, setPosition] = useState({ x: 60, y: 200 });
  const [rotation, setRotation] = useState(0);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const rotateRef = useRef<{ startAngle: number; startRotation: number; cx: number; cy: number } | null>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  // Emit ruler line in world coordinates whenever position/rotation/zoom/pan changes
  useEffect(() => {
    if (!visible) {
      onRulerUpdate(null);
      return;
    }
    
    const zoom = zoomRef.current;
    const pan = panRef.current;
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    
    // Bottom edge of ruler in screen coords (relative to container)
    const bx = position.x;
    const by = position.y + RULER_HEIGHT;
    const ex = position.x + RULER_WIDTH * cos;
    const ey = position.y + RULER_WIDTH * sin + RULER_HEIGHT * cos;
    
    // Convert screen coords to world coords
    const x1 = (bx - pan.x) / zoom;
    const y1 = (by - pan.y) / zoom;
    const x2 = (ex - pan.x) / zoom;
    const y2 = (ey - pan.y) / zoom;
    
    // Normal pointing downward (away from ruler body)
    const ldx = x2 - x1;
    const ldy = y2 - y1;
    const len = Math.sqrt(ldx * ldx + ldy * ldy);
    const nx = len > 0 ? -ldy / len : 0;
    const ny = len > 0 ? ldx / len : 0;
    
    onRulerUpdate({ x1, y1, x2, y2, nx, ny });
  }, [visible, position, rotation, zoomDisplay, onRulerUpdate]);

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
    };
  }, [position]);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPosition({
        x: dragRef.current.startPosX + dx,
        y: dragRef.current.startPosY + dy,
      });
    }
    if (rotateRef.current) {
      const angle = Math.atan2(
        e.clientY - rotateRef.current.cy,
        e.clientX - rotateRef.current.cx
      ) * (180 / Math.PI);
      let newRot = rotateRef.current.startRotation + (angle - rotateRef.current.startAngle);
      // Snap to 0, 45, 90, etc. if within 3 degrees
      const snapAngles = [0, 45, 90, 135, 180, -45, -90, -135, -180];
      for (const sa of snapAngles) {
        if (Math.abs(newRot - sa) < 3) { newRot = sa; break; }
      }
      setRotation(newRot);
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    dragRef.current = null;
    rotateRef.current = null;
  }, []);

  const handleRotateStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
    rotateRef.current = { startAngle, startRotation: rotation, cx, cy };
  }, [rotation]);

  if (!visible) return null;

  return (
    <div
      ref={rulerRef}
      className="absolute z-30 select-none"
      style={{
        left: position.x,
        top: position.y,
        width: RULER_WIDTH,
        height: RULER_HEIGHT,
        transform: `rotate(${rotation}deg)`,
        transformOrigin: '0% 50%',
        cursor: 'grab',
        touchAction: 'none',
      }}
      onPointerDown={handleDragStart}
      onPointerMove={handleDragMove}
      onPointerUp={handleDragEnd}
      onPointerCancel={handleDragEnd}
    >
      {/* Ruler body - transparent 3D look */}
      <div
        className="relative w-full h-full rounded-sm overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(240,238,230,0.35) 40%, rgba(220,215,200,0.3) 100%)',
          backdropFilter: 'blur(2px)',
          boxShadow: `
            0 2px 8px rgba(0,0,0,0.15),
            0 4px 16px rgba(0,0,0,0.08),
            inset 0 1px 0 rgba(255,255,255,0.6),
            inset 0 -1px 0 rgba(0,0,0,0.08)
          `,
          border: '1px solid rgba(180,175,160,0.4)',
        }}
      >
        {/* Top highlight for 3D effect */}
        <div
          className="absolute inset-x-0 top-0 h-[3px]"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.7) 0%, transparent 100%)',
          }}
        />
        
        {/* CM markings */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox={`0 0 ${RULER_WIDTH} ${RULER_HEIGHT}`}
          preserveAspectRatio="none"
        >
          {/* MM and CM tick marks along bottom edge */}
          {Array.from({ length: Math.floor(RULER_WIDTH / 3.78) + 1 }, (_, i) => {
            const x = 10 + i * 3.78; // ~1mm at scale
            if (x > RULER_WIDTH - 5) return null;
            const isCm = i % 10 === 0;
            const isHalfCm = i % 5 === 0;
            const tickH = isCm ? 16 : isHalfCm ? 10 : 5;
            return (
              <g key={i}>
                <line
                  x1={x} y1={RULER_HEIGHT}
                  x2={x} y2={RULER_HEIGHT - tickH}
                  stroke="rgba(60,55,45,0.55)"
                  strokeWidth={isCm ? 1 : 0.5}
                />
                {isCm && i > 0 && (
                  <text
                    x={x}
                    y={RULER_HEIGHT - 18}
                    textAnchor="middle"
                    fontSize="8"
                    fill="rgba(60,55,45,0.7)"
                    fontFamily="system-ui"
                  >
                    {i / 10}
                  </text>
                )}
              </g>
            );
          })}
          {/* Unit label */}
          <text
            x={16}
            y={14}
            fontSize="7"
            fill="rgba(60,55,45,0.5)"
            fontFamily="system-ui"
          >
            cm
          </text>
        </svg>

        {/* Bottom edge indicator (the drawing edge) */}
        <div
          className="absolute inset-x-0 bottom-0 h-[2px]"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(59,130,246,0.5) 10%, rgba(59,130,246,0.5) 90%, transparent 100%)',
          }}
        />
      </div>

      {/* Rotate handle */}
      <div
        className="absolute -right-6 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing"
        style={{
          background: 'rgba(59,130,246,0.8)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
        }}
        onPointerDown={handleRotateStart}
      >
        <RotateCw className="h-3 w-3 text-white" strokeWidth={2.5} />
      </div>

      {/* Close button */}
      <div
        className="absolute -right-2 -top-3 w-4 h-4 rounded-full flex items-center justify-center cursor-pointer"
        style={{
          background: 'rgba(239,68,68,0.85)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X className="h-2.5 w-2.5 text-white" strokeWidth={3} />
      </div>
    </div>
  );
});

CanvasRuler.displayName = 'CanvasRuler';
