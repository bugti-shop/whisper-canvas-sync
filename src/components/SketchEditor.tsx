import { useCallback, useEffect, useRef, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import {
  Pen, Eraser, Undo2, Redo2, Trash2, Palette, Minus,
  Minus as LineIcon, Square, Circle, MoveRight, Ruler,
  Pencil, PenTool, Highlighter, SprayCan, Brush,
  Layers, Eye, EyeOff, Maximize, Pipette, Grid3X3,
  MousePointer2, Copy, Clipboard, Trash, RotateCw, Focus,
  Download, Share2, FileText, FileImage, FileCode, Play, Save, FolderOpen, Plus, Film,
  Type, Bold, Italic, Triangle, Star, Diamond, Hexagon, Navigation,
  Droplets, CircleDot, PaintbrushVertical, PenLine, StickyNote, ImagePlus, Sparkles,
  Heart, Cloud, MessageSquare, Pentagon, Moon, Cylinder,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Share } from '@capacitor/share';
import { jsPDF } from 'jspdf';

// --- Types ---

type DrawToolType = 'pencil' | 'pen' | 'marker' | 'highlighter' | 'calligraphy' | 'spray' | 'fountain' | 'crayon' | 'watercolor' | 'dotpen' | 'neon';
type ShapeToolType = 'line' | 'rect' | 'circle' | 'arrow' | 'triangle' | 'star' | 'diamond' | 'polygon' | 'pentagon' | 'heart' | 'moon' | 'cloud' | 'speechBubble' | 'cylinder' | 'trapezoid' | 'cone';
type ToolType = DrawToolType | ShapeToolType | 'eraser' | 'select' | 'text' | 'sticky' | 'image';
type BackgroundType = 'plain' | 'grid-sm' | 'grid-lg' | 'dotted' | 'ruled' | 'isometric' | 'dark';

interface Point {
  x: number;
  y: number;
  pressure: number;
  timestamp?: number;
}

interface TextAnnotation {
  id: number;
  x: number;
  y: number;
  text: string;
  font: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
}

interface StickyNoteData {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
  fontSize: number;
  rotation?: number;
}

interface CanvasImageData {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  src: string; // base64 data URL
  naturalWidth: number;
  naturalHeight: number;
}

interface Stroke {
  points: Point[];
  color: string;
  width: number;
  tool: ToolType;
  fillColor?: string;
  fillOpacity?: number;
}

interface Layer {
  id: number;
  name: string;
  strokes: Stroke[];
  textAnnotations: TextAnnotation[];
  stickyNotes: StickyNoteData[];
  images: CanvasImageData[];
  opacity: number;
  visible: boolean;
}

export interface SketchData {
  layers: Layer[];
  activeLayerId: number;
  background?: BackgroundType;
  width: number;
  height: number;
  version: 2;
  strokes?: Stroke[];
}

interface BBox {
  x: number; y: number; w: number; h: number;
}

type HandleType = 'tl' | 'tr' | 'bl' | 'br' | 'rotate' | 'body';

// --- Constants ---

const MAX_UNDO = 50;
const MIN_POINT_DISTANCE = 1;
const SMOOTHING_FACTOR = 0.3; // 0 = no smoothing, 1 = max smoothing
const PALM_REJECTION_RADIUS = 20;
const MAX_LAYERS = 3;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const DOUBLE_TAP_DELAY = 400;
const MAX_RECENT_COLORS = 8;
const HANDLE_SIZE = 8;
const HIT_TOLERANCE = 12;

const GRID_SIZES: Record<BackgroundType, number> = {
  'plain': 20, 'grid-sm': 16, 'grid-lg': 40, 'dotted': 20,
  'ruled': 28, 'isometric': 30, 'dark': 20,
};

const snapToGrid = (val: number, gridSize: number): number =>
  Math.round(val / gridSize) * gridSize;

const SHAPE_TOOLS: { id: ShapeToolType; icon: typeof Pen; label: string }[] = [
  { id: 'line', icon: LineIcon, label: 'Line' },
  { id: 'rect', icon: Square, label: 'Rectangle' },
  { id: 'circle', icon: Circle, label: 'Circle' },
  { id: 'arrow', icon: MoveRight, label: 'Arrow' },
  { id: 'triangle', icon: Triangle, label: 'Triangle' },
  { id: 'star', icon: Star, label: 'Star' },
  { id: 'diamond', icon: Diamond, label: 'Diamond' },
  { id: 'polygon', icon: Hexagon, label: 'Hexagon' },
  { id: 'pentagon', icon: Pentagon, label: 'Pentagon' },
  { id: 'heart', icon: Heart, label: 'Heart' },
  { id: 'moon', icon: Moon, label: 'Moon' },
  { id: 'cloud', icon: Cloud, label: 'Cloud' },
  { id: 'speechBubble', icon: MessageSquare, label: 'Speech Bubble' },
  { id: 'cylinder', icon: Cylinder, label: 'Cylinder' },
  { id: 'trapezoid', icon: Navigation, label: 'Trapezoid' },
  { id: 'cone', icon: Triangle, label: 'Cone' },
];

const DRAW_TOOLS: { id: DrawToolType; icon: typeof Pen; label: string }[] = [
  { id: 'pencil', icon: Pencil, label: 'Pencil' },
  { id: 'pen', icon: Pen, label: 'Pen' },
  { id: 'fountain', icon: PenLine, label: 'Fountain' },
  { id: 'marker', icon: PenTool, label: 'Marker' },
  { id: 'highlighter', icon: Highlighter, label: 'Highlighter' },
  { id: 'calligraphy', icon: Brush, label: 'Calligraphy' },
  { id: 'crayon', icon: PaintbrushVertical, label: 'Crayon' },
  { id: 'watercolor', icon: Droplets, label: 'Watercolor' },
  { id: 'spray', icon: SprayCan, label: 'Spray' },
  { id: 'dotpen', icon: CircleDot, label: 'Dot Pen' },
  { id: 'neon', icon: Sparkles, label: 'Neon Glow' },
];

const BACKGROUNDS: { id: BackgroundType; label: string }[] = [
  { id: 'plain', label: 'Plain' },
  { id: 'grid-sm', label: 'Small Grid' },
  { id: 'grid-lg', label: 'Large Grid' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'ruled', label: 'Ruled' },
  { id: 'isometric', label: 'Isometric' },
  { id: 'dark', label: 'Dark' },
];

const isDrawingTool = (t: ToolType): t is DrawToolType | ShapeToolType | 'eraser' =>
  t !== 'select' && t !== 'text' && t !== 'sticky' && t !== 'image';

const STICKY_COLORS = [
  '#FEF3C7', // warm yellow
  '#FBCFE8', // pink
  '#BBF7D0', // green
  '#BFDBFE', // blue
  '#E9D5FF', // purple
  '#FED7AA', // orange
  '#FECACA', // red
  '#D1FAE5', // teal
];

const isShapeTool = (t: ToolType): t is ShapeToolType =>
  ['line','rect','circle','arrow','triangle','star','diamond','polygon','pentagon','heart','moon','cloud','speechBubble','cylinder','trapezoid','cone'].includes(t);

const TEXT_FONTS = [
  { id: 'sans-serif', label: 'Sans Serif' },
  { id: 'serif', label: 'Serif' },
  { id: 'monospace', label: 'Mono' },
  { id: 'cursive', label: 'Cursive' },
  { id: '"Georgia", serif', label: 'Georgia' },
];

const createDefaultLayers = (): Layer[] => [
  { id: 1, name: 'Layer 1', strokes: [], textAnnotations: [], stickyNotes: [], images: [], opacity: 1, visible: true },
  { id: 2, name: 'Layer 2', strokes: [], textAnnotations: [], stickyNotes: [], images: [], opacity: 1, visible: true },
  { id: 3, name: 'Layer 3', strokes: [], textAnnotations: [], stickyNotes: [], images: [], opacity: 1, visible: true },
];

// --- Helpers ---

const seededRandom = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

const hexToRgba = (hex: string, alpha: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const hslToHex = (h: number, s: number, l: number): string => {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * Math.max(0, Math.min(1, color)))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

const hexToHsl = (hex: string): [number, number, number] => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
};

// --- Selection helpers ---

const getStrokeBBox = (stroke: Stroke): BBox => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of stroke.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = stroke.width * 2;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
};

const getSelectionBBox = (strokes: Stroke[]): BBox | null => {
  if (strokes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    const b = getStrokeBBox(s);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

const distToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2);
};

const hitTestStroke = (stroke: Stroke, px: number, py: number, tolerance: number): boolean => {
  if (stroke.tool === 'eraser') return false;
  // Quick bbox check
  const bbox = getStrokeBBox(stroke);
  if (px < bbox.x - tolerance || px > bbox.x + bbox.w + tolerance ||
      py < bbox.y - tolerance || py > bbox.y + bbox.h + tolerance) return false;

  for (let i = 0; i < stroke.points.length - 1; i++) {
    const a = stroke.points[i], b = stroke.points[i + 1];
    if (distToSegment(px, py, a.x, a.y, b.x, b.y) < tolerance + stroke.width) return true;
  }
  // Single point
  if (stroke.points.length === 1) {
    const p = stroke.points[0];
    return Math.sqrt((px - p.x) ** 2 + (py - p.y) ** 2) < tolerance + stroke.width;
  }
  return false;
};

const hitTestHandle = (px: number, py: number, bbox: BBox, zoom: number): HandleType | null => {
  const hs = HANDLE_SIZE / zoom;
  const corners: [number, number, HandleType][] = [
    [bbox.x, bbox.y, 'tl'],
    [bbox.x + bbox.w, bbox.y, 'tr'],
    [bbox.x, bbox.y + bbox.h, 'bl'],
    [bbox.x + bbox.w, bbox.y + bbox.h, 'br'],
  ];
  // Rotate handle above top center
  const rotX = bbox.x + bbox.w / 2;
  const rotY = bbox.y - 24 / zoom;
  if (Math.abs(px - rotX) < hs * 1.5 && Math.abs(py - rotY) < hs * 1.5) return 'rotate';

  for (const [cx, cy, type] of corners) {
    if (Math.abs(px - cx) < hs * 1.5 && Math.abs(py - cy) < hs * 1.5) return type;
  }
  // Body (inside bbox)
  if (px >= bbox.x && px <= bbox.x + bbox.w && py >= bbox.y && py <= bbox.y + bbox.h) return 'body';
  return null;
};

const transformStrokes = (
  strokes: Stroke[],
  origBBox: BBox,
  newBBox: BBox,
  rotation: number,
): Stroke[] => {
  const cx = origBBox.x + origBBox.w / 2;
  const cy = origBBox.y + origBBox.h / 2;
  const ncx = newBBox.x + newBBox.w / 2;
  const ncy = newBBox.y + newBBox.h / 2;
  const sx = origBBox.w > 0 ? newBBox.w / origBBox.w : 1;
  const sy = origBBox.h > 0 ? newBBox.h / origBBox.h : 1;
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);

  return strokes.map(s => ({
    ...s,
    points: s.points.map(p => {
      // Scale relative to original center
      let x = (p.x - cx) * sx;
      let y = (p.y - cy) * sy;
      // Rotate
      const rx = x * cosR - y * sinR;
      const ry = x * sinR + y * cosR;
      return { ...p, x: rx + ncx, y: ry + ncy };
    }),
  }));
};

const cloneStrokes = (strokes: Stroke[]): Stroke[] =>
  strokes.map(s => ({ ...s, points: s.points.map(p => ({ ...p })) }));

// --- Background drawing ---

const drawBackground = (
  ctx: CanvasRenderingContext2D, 
  x0: number, y0: number, x1: number, y1: number, 
  bg: BackgroundType,
  gridColor?: string,
  gridOpacity?: number
) => {
  ctx.save();
  const w = x1 - x0;
  const h = y1 - y0;

  if (bg === 'dark') {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(x0, y0, w, h);
    ctx.restore();
    return;
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x0, y0, w, h);

  const gOpacity = gridOpacity ?? 0.45;
  const gColor = gridColor ?? '#8c8c8c';
  const lineColor = `${gColor}${Math.round(gOpacity * 255).toString(16).padStart(2, '0')}`;
  const dotColor = `${gColor}${Math.round(Math.min(1, gOpacity + 0.1) * 255).toString(16).padStart(2, '0')}`;

  // Helper: snap start to grid origin so lines tile seamlessly
  const gridStart = (origin: number, step: number) => Math.floor(origin / step) * step;

  switch (bg) {
    case 'plain': break;
    case 'grid-sm': {
      const s = 16;
      ctx.strokeStyle = lineColor; ctx.lineWidth = 0.5;
      for (let x = gridStart(x0, s); x <= x1; x += s) { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); }
      for (let y = gridStart(y0, s); y <= y1; y += s) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
      break;
    }
    case 'grid-lg': {
      const s = 40;
      ctx.strokeStyle = lineColor; ctx.lineWidth = 0.5;
      for (let x = gridStart(x0, s); x <= x1; x += s) { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); }
      for (let y = gridStart(y0, s); y <= y1; y += s) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
      break;
    }
    case 'dotted': {
      const s = 20;
      ctx.fillStyle = dotColor;
      for (let x = gridStart(x0, s); x <= x1; x += s) { for (let y = gridStart(y0, s); y <= y1; y += s) { ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill(); } }
      break;
    }
    case 'ruled': {
      const lineHeight = 28;
      ctx.strokeStyle = `${gColor}${Math.round(Math.min(1, gOpacity + 0.15) * 255).toString(16).padStart(2, '0')}`;
      ctx.lineWidth = 0.7;
      const startY = gridStart(y0, lineHeight);
      for (let y = startY; y <= y1; y += lineHeight) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
      break;
    }
    case 'isometric': {
      ctx.strokeStyle = lineColor; ctx.lineWidth = 0.5;
      const size = 30; const rowH = size * Math.sin(Math.PI / 3);
      const startRow = Math.floor(y0 / rowH);
      const endRow = Math.ceil(y1 / rowH) + 1;
      for (let row = startRow; row <= endRow; row++) {
        const y = row * rowH; const offset = row % 2 === 0 ? 0 : size / 2;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        const startX = Math.floor((x0 - size) / size) * size + offset;
        for (let x = startX; x <= x1 + size; x += size) {
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + size / 2, y + rowH); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - size / 2, y + rowH); ctx.stroke();
        }
      }
      break;
    }
  }
  ctx.restore();
};

// --- HSL Color Wheel Canvas Component ---

const HSL_WHEEL_SIZE = 160;

const HslColorWheel = memo(({
  hue, saturation, lightness,
  onHueChange, onSatLightChange,
}: {
  hue: number; saturation: number; lightness: number;
  onHueChange: (h: number) => void;
  onSatLightChange: (s: number, l: number) => void;
}) => {
  const wheelRef = useRef<HTMLCanvasElement>(null);
  const slRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = wheelRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const size = HSL_WHEEL_SIZE;
    const cx = size / 2, cy = size / 2;
    const outerR = size / 2 - 2, innerR = outerR - 18;
    ctx.clearRect(0, 0, size, size);
    for (let angle = 0; angle < 360; angle++) {
      const rad1 = (angle - 0.5) * (Math.PI / 180);
      const rad2 = (angle + 0.5) * (Math.PI / 180);
      ctx.beginPath(); ctx.arc(cx, cy, outerR, rad1, rad2); ctx.arc(cx, cy, innerR, rad2, rad1, true); ctx.closePath();
      ctx.fillStyle = `hsl(${angle}, 100%, 50%)`; ctx.fill();
    }
    const hueRad = (hue - 90) * (Math.PI / 180);
    const midR = (outerR + innerR) / 2;
    const ix = cx + Math.cos(hueRad) * midR;
    const iy = cy + Math.sin(hueRad) * midR;
    ctx.beginPath(); ctx.arc(ix, iy, 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
  }, [hue]);

  useEffect(() => {
    const canvas = slRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const s = 90; canvas.width = s; canvas.height = s;
    const imgData = ctx.createImageData(s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const sat = x / s; const light = 1 - y / s;
        const hex = hslToHex(hue, sat, light);
        const r = parseInt(hex.slice(1, 3), 16); const g = parseInt(hex.slice(3, 5), 16); const b = parseInt(hex.slice(5, 7), 16);
        const idx = (y * s + x) * 4;
        imgData.data[idx] = r; imgData.data[idx + 1] = g; imgData.data[idx + 2] = b; imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    const ix = saturation * s; const iy = (1 - lightness) * s;
    ctx.beginPath(); ctx.arc(ix, iy, 5, 0, Math.PI * 2);
    ctx.strokeStyle = lightness > 0.5 ? '#000' : '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }, [hue, saturation, lightness]);

  const handleWheelPointer = (e: React.PointerEvent) => {
    const canvas = wheelRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    let angle = Math.atan2(e.clientY - rect.top - cy, e.clientX - rect.left - cx) * (180 / Math.PI) + 90;
    if (angle < 0) angle += 360;
    onHueChange(angle);
  };

  const handleSLPointer = (e: React.PointerEvent) => {
    const canvas = slRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    onSatLightChange(x, 1 - y);
  };

  const [draggingWheel, setDraggingWheel] = useState(false);
  const [draggingSL, setDraggingSL] = useState(false);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: HSL_WHEEL_SIZE, height: HSL_WHEEL_SIZE }}>
        <canvas ref={wheelRef} width={HSL_WHEEL_SIZE} height={HSL_WHEEL_SIZE} className="absolute inset-0 cursor-crosshair"
          onPointerDown={(e) => { setDraggingWheel(true); (e.target as HTMLElement).setPointerCapture(e.pointerId); handleWheelPointer(e); }}
          onPointerMove={(e) => draggingWheel && handleWheelPointer(e)}
          onPointerUp={() => setDraggingWheel(false)}
        />
        <canvas ref={slRef} width={90} height={90} className="absolute cursor-crosshair rounded-sm"
          style={{ left: (HSL_WHEEL_SIZE - 90) / 2, top: (HSL_WHEEL_SIZE - 90) / 2 }}
          onPointerDown={(e) => { setDraggingSL(true); (e.target as HTMLElement).setPointerCapture(e.pointerId); handleSLPointer(e); }}
          onPointerMove={(e) => draggingSL && handleSLPointer(e)}
          onPointerUp={() => setDraggingSL(false)}
        />
      </div>
    </div>
  );
});
HslColorWheel.displayName = 'HslColorWheel';

// --- Drawing helpers ---

const drawArrowhead = (ctx: CanvasRenderingContext2D, from: Point, to: Point, size: number) => {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - Math.PI / 6), to.y - size * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle + Math.PI / 6), to.y - size * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
};

const drawStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
  if (stroke.points.length < 1) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const start = stroke.points[0];
  const end = stroke.points[stroke.points.length - 1];

  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = stroke.width;
    if (stroke.points.length < 2) { ctx.restore(); return; }
    ctx.beginPath(); ctx.moveTo(start.x, start.y);
    for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    ctx.stroke(); ctx.restore(); return;
  }

  ctx.globalCompositeOperation = 'source-over';

  if (isShapeTool(stroke.tool)) {
    if (stroke.points.length < 2) { ctx.restore(); return; }
    ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.width;
    const hasFill = stroke.fillColor && stroke.fillOpacity && stroke.fillOpacity > 0;
    switch (stroke.tool) {
      case 'line': ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke(); break;
      case 'rect':
        if (hasFill) {
          ctx.fillStyle = hexToRgba(stroke.fillColor!, stroke.fillOpacity!);
          ctx.fillRect(start.x, start.y, end.x - start.x, end.y - start.y);
        }
        ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
        break;
      case 'circle': {
        const rx = Math.abs(end.x - start.x) / 2; const ry = Math.abs(end.y - start.y) / 2;
        const cx = start.x + (end.x - start.x) / 2; const cy = start.y + (end.y - start.y) / 2;
        ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
        if (hasFill) {
          ctx.fillStyle = hexToRgba(stroke.fillColor!, stroke.fillOpacity!);
          ctx.fill();
        }
        ctx.stroke();
        break;
      }
      case 'arrow':
        ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
        drawArrowhead(ctx, start, end, Math.max(10, stroke.width * 3)); break;
      case 'triangle': {
        const mx = (start.x + end.x) / 2;
        ctx.beginPath(); ctx.moveTo(mx, start.y); ctx.lineTo(end.x, end.y); ctx.lineTo(start.x, end.y); ctx.closePath();
        if (hasFill) { ctx.fillStyle = hexToRgba(stroke.fillColor!, stroke.fillOpacity!); ctx.fill(); }
        ctx.stroke(); break;
      }
      case 'diamond': {
        const cx = (start.x + end.x) / 2, cy = (start.y + end.y) / 2;
        ctx.beginPath(); ctx.moveTo(cx, start.y); ctx.lineTo(end.x, cy); ctx.lineTo(cx, end.y); ctx.lineTo(start.x, cy); ctx.closePath();
        if (hasFill) { ctx.fillStyle = hexToRgba(stroke.fillColor!, stroke.fillOpacity!); ctx.fill(); }
        ctx.stroke(); break;
      }
      case 'star': {
        const cx = (start.x + end.x) / 2, cy = (start.y + end.y) / 2;
        const outerR = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) / 2;
        const innerR = outerR * 0.4;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? outerR : innerR;
          const angle = (i * Math.PI / 5) - Math.PI / 2;
          const px = cx + r * Math.cos(angle), py = cy + r * Math.sin(angle);
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        if (hasFill) { ctx.fillStyle = hexToRgba(stroke.fillColor!, stroke.fillOpacity!); ctx.fill(); }
        ctx.stroke(); break;
      }
      case 'polygon': {
        const cx = (start.x + end.x) / 2, cy = (start.y + end.y) / 2;
        const r = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) / 2;
        const sides = 6;
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
          const angle = (i * 2 * Math.PI / sides) - Math.PI / 2;
          const px = cx + r * Math.cos(angle), py = cy + r * Math.sin(angle);
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        if (hasFill) { ctx.fillStyle = hexToRgba(stroke.fillColor!, stroke.fillOpacity!); ctx.fill(); }
        ctx.stroke(); break;
      }
      case 'pentagon': {
        const cx = (start.x + end.x) / 2, cy = (start.y + end.y) / 2;
        const r = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) / 2;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const angle = (i * 2 * Math.PI / 5) - Math.PI / 2;
          const px = cx + r * Math.cos(angle), py = cy + r * Math.sin(angle);
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        if (hasFill) { ctx.fillStyle = hexToRgba(stroke.fillColor!, stroke.fillOpacity!); ctx.fill(); }
        ctx.stroke(); break;
      }
      case 'heart': {
        const cx = (start.x + end.x) / 2, cy = (start.y + end.y) / 2;
        const w = Math.abs(end.x - start.x) / 2, h = Math.abs(end.y - start.y) / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy + h * 0.9);
        ctx.bezierCurveTo(cx - w * 0.1, cy + h * 0.6, cx - w, cy + h * 0.2, cx - w, cy - h * 0.2);
        ctx.bezierCurveTo(cx - w, cy - h * 0.8, cx - w * 0.4, cy - h, cx, cy - h * 0.4);
        ctx.bezierCurveTo(cx + w * 0.4, cy - h, cx + w, cy - h * 0.8, cx + w, cy - h * 0.2);
        ctx.bezierCurveTo(cx + w, cy + h * 0.2, cx + w * 0.1, cy + h * 0.6, cx, cy + h * 0.9);
        ctx.closePath();
        if (hasFill) { ctx.fillStyle = hexToRgba(stroke.fillColor!, stroke.fillOpacity!); ctx.fill(); }
        ctx.stroke(); break;
      }
      case 'moon': {
        const cx = (start.x + end.x) / 2, cy = (start.y + end.y) / 2;
        const r = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        if (hasFill) { ctx.fillStyle = hexToRgba(stroke.fillColor!, stroke.fillOpacity!); ctx.fill(); }
        ctx.stroke();
        // Inner cutout
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(cx + r * 0.4, cy - r * 0.1, r * 0.75, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // Re-stroke outline
        ctx.beginPath();
        ctx.arc(cx, cy, r, -0.55, Math.PI + 0.55);
        ctx.stroke();
        break;
      }
      case 'cloud': {
        const cx = (start.x + end.x) / 2, cy = (start.y + end.y) / 2;
        const w = Math.abs(end.x - start.x) / 2, h = Math.abs(end.y - start.y) / 2;
        ctx.beginPath();
        ctx.moveTo(cx - w * 0.6, cy + h * 0.3);
        ctx.bezierCurveTo(cx - w, cy + h * 0.3, cx - w, cy - h * 0.2, cx - w * 0.6, cy - h * 0.3);
        ctx.bezierCurveTo(cx - w * 0.6, cy - h * 0.8, cx - w * 0.1, cy - h, cx + w * 0.1, cy - h * 0.7);
        ctx.bezierCurveTo(cx + w * 0.3, cy - h, cx + w * 0.8, cy - h * 0.8, cx + w * 0.7, cy - h * 0.3);
        ctx.bezierCurveTo(cx + w, cy - h * 0.2, cx + w, cy + h * 0.3, cx + w * 0.6, cy + h * 0.3);
        ctx.closePath();
        if (hasFill) { ctx.fillStyle = hexToRgba(stroke.fillColor!, stroke.fillOpacity!); ctx.fill(); }
        ctx.stroke(); break;
      }
      case 'speechBubble': {
        const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
        const r2 = Math.min(w, h) * 0.15;
        const tailH = h * 0.2;
        const bodyH = h - tailH;
        ctx.beginPath();
        ctx.moveTo(x + r2, y); ctx.lineTo(x + w - r2, y);
        ctx.arcTo(x + w, y, x + w, y + r2, r2);
        ctx.lineTo(x + w, y + bodyH - r2);
        ctx.arcTo(x + w, y + bodyH, x + w - r2, y + bodyH, r2);
        ctx.lineTo(x + w * 0.35, y + bodyH);
        ctx.lineTo(x + w * 0.15, y + h);
        ctx.lineTo(x + w * 0.25, y + bodyH);
        ctx.lineTo(x + r2, y + bodyH);
        ctx.arcTo(x, y + bodyH, x, y + bodyH - r2, r2);
        ctx.lineTo(x, y + r2);
        ctx.arcTo(x, y, x + r2, y, r2);
        ctx.closePath();
        if (hasFill) { ctx.fillStyle = hexToRgba(stroke.fillColor!, stroke.fillOpacity!); ctx.fill(); }
        ctx.stroke(); break;
      }
      case 'cylinder': {
        const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
        const ellipseH = h * 0.15;
        const cx = x + w / 2;
        if (hasFill) {
          ctx.fillStyle = hexToRgba(stroke.fillColor!, stroke.fillOpacity!);
          ctx.beginPath(); ctx.ellipse(cx, y + ellipseH, w / 2, ellipseH, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillRect(x, y + ellipseH, w, h - ellipseH * 2);
          ctx.beginPath(); ctx.ellipse(cx, y + h - ellipseH, w / 2, ellipseH, 0, 0, Math.PI * 2); ctx.fill();
        }
        // Side lines
        ctx.beginPath(); ctx.moveTo(x, y + ellipseH); ctx.lineTo(x, y + h - ellipseH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + w, y + ellipseH); ctx.lineTo(x + w, y + h - ellipseH); ctx.stroke();
        // Top ellipse
        ctx.beginPath(); ctx.ellipse(cx, y + ellipseH, w / 2, ellipseH, 0, 0, Math.PI * 2); ctx.stroke();
        // Bottom ellipse
        ctx.beginPath(); ctx.ellipse(cx, y + h - ellipseH, w / 2, ellipseH, 0, 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case 'trapezoid': {
        const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
        const inset = w * 0.2;
        ctx.beginPath();
        ctx.moveTo(x + inset, y); ctx.lineTo(x + w - inset, y);
        ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h);
        ctx.closePath();
        if (hasFill) { ctx.fillStyle = hexToRgba(stroke.fillColor!, stroke.fillOpacity!); ctx.fill(); }
        ctx.stroke(); break;
      }
      case 'cone': {
        const cx = (start.x + end.x) / 2;
        const y = Math.min(start.y, end.y), h = Math.abs(end.y - start.y);
        const w = Math.abs(end.x - start.x) / 2;
        const ellipseH = h * 0.12;
        ctx.beginPath();
        ctx.moveTo(cx, y); ctx.lineTo(cx + w, y + h - ellipseH); 
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, y); ctx.lineTo(cx - w, y + h - ellipseH);
        ctx.stroke();
        ctx.beginPath(); ctx.ellipse(cx, y + h - ellipseH, w, ellipseH, 0, 0, Math.PI * 2);
        if (hasFill) { ctx.fillStyle = hexToRgba(stroke.fillColor!, stroke.fillOpacity!); ctx.fill(); }
        ctx.stroke(); break;
      }
    }
    ctx.restore(); return;
  }

  if (stroke.points.length < 2 && stroke.tool !== 'spray') { ctx.restore(); return; }

  switch (stroke.tool) {
    case 'pencil': {
      ctx.strokeStyle = stroke.color; ctx.globalAlpha = 0.85;
      // Main stroke with smooth curves
      ctx.lineWidth = stroke.width * 0.6;
      ctx.beginPath(); ctx.moveTo(start.x, start.y);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const curr = stroke.points[i]; const next = stroke.points[i + 1];
        const pressure = Math.max(0.2, curr.pressure);
        ctx.lineWidth = stroke.width * pressure * 0.6;
        const jx = Math.sin(i * 7.3 + curr.x * 0.1) * 0.4; const jy = Math.cos(i * 5.1 + curr.y * 0.1) * 0.4;
        ctx.quadraticCurveTo(curr.x + jx, curr.y + jy, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
      }
      if (stroke.points.length >= 2) ctx.lineTo(end.x, end.y);
      ctx.stroke();
      // Subtle texture overlay
      ctx.globalAlpha = 0.2;
      ctx.lineWidth = stroke.width * 0.25;
      ctx.beginPath(); ctx.moveTo(start.x + 0.3, start.y - 0.3);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const curr = stroke.points[i]; const next = stroke.points[i + 1];
        ctx.quadraticCurveTo(curr.x - 0.3, curr.y + 0.3, (curr.x + next.x) / 2 + 0.2, (curr.y + next.y) / 2 - 0.2);
      }
      if (stroke.points.length >= 2) ctx.lineTo(end.x - 0.3, end.y + 0.3);
      ctx.stroke();
      break;
    }
    case 'pen': {
      ctx.strokeStyle = stroke.color;
      if (stroke.points.length === 2) {
        ctx.lineWidth = stroke.width;
        ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      } else {
        // Draw as a single continuous path using average pressure for smooth lines
        // Group points into segments of similar pressure to minimize beginPath calls
        let segStart = 0;
        const pressureThreshold = 0.15;
        
        const drawSegment = (fromIdx: number, toIdx: number) => {
          if (toIdx - fromIdx < 1) return;
          let avgPressure = 0;
          for (let j = fromIdx; j <= toIdx; j++) avgPressure += stroke.points[j].pressure;
          avgPressure = Math.max(0.3, avgPressure / (toIdx - fromIdx + 1));
          ctx.lineWidth = stroke.width * avgPressure;
          ctx.beginPath();
          // Extend slightly before start for overlap
          const p0 = stroke.points[fromIdx];
          ctx.moveTo(p0.x, p0.y);
          for (let j = fromIdx + 1; j < toIdx; j++) {
            const curr = stroke.points[j]; const next = stroke.points[j + 1];
            ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
          }
          ctx.lineTo(stroke.points[toIdx].x, stroke.points[toIdx].y);
          ctx.stroke();
        };

        for (let i = 1; i < stroke.points.length; i++) {
          const pDiff = Math.abs(stroke.points[i].pressure - stroke.points[segStart].pressure);
          if (pDiff > pressureThreshold || i === stroke.points.length - 1) {
            // Overlap by 1 point to eliminate gaps
            drawSegment(segStart, i);
            segStart = Math.max(0, i - 1);
          }
        }
      }
      break;
    }
    case 'marker': {
      // Realistic chisel-tip marker: flat edge with slight texture
      const markerWidth = stroke.width * 3;
      ctx.lineCap = 'square';
      ctx.lineJoin = 'miter';
      // Base layer - semi-transparent, flat chisel look
      ctx.strokeStyle = hexToRgba(stroke.color, 0.5);
      ctx.lineWidth = markerWidth;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const curr = stroke.points[i]; const next = stroke.points[i + 1];
        const mx = (curr.x + next.x) / 2, my = (curr.y + next.y) / 2;
        ctx.quadraticCurveTo(curr.x, curr.y, mx, my);
      }
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      // Edge darkening layer for ink-pooling effect
      ctx.strokeStyle = hexToRgba(stroke.color, 0.15);
      ctx.lineWidth = markerWidth * 1.1;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const curr = stroke.points[i]; const next = stroke.points[i + 1];
        const mx = (curr.x + next.x) / 2, my = (curr.y + next.y) / 2;
        ctx.quadraticCurveTo(curr.x, curr.y, mx, my);
      }
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      // Center highlight for glossy feel
      ctx.strokeStyle = hexToRgba(stroke.color, 0.25);
      ctx.lineWidth = markerWidth * 0.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const curr = stroke.points[i]; const next = stroke.points[i + 1];
        const mx = (curr.x + next.x) / 2, my = (curr.y + next.y) / 2;
        ctx.quadraticCurveTo(curr.x, curr.y, mx, my);
      }
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      break;
    }
    case 'highlighter': {
      // Realistic highlighter: flat rectangular tip, transparent, multiply blend
      const hlWidth = stroke.width * 4.5;
      ctx.globalCompositeOperation = 'multiply';
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'bevel';
      // Main highlight pass - flat transparent band
      ctx.strokeStyle = hexToRgba(stroke.color, 0.3);
      ctx.lineWidth = hlWidth;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const curr = stroke.points[i]; const next = stroke.points[i + 1];
        const mx = (curr.x + next.x) / 2, my = (curr.y + next.y) / 2;
        ctx.quadraticCurveTo(curr.x, curr.y, mx, my);
      }
      if (stroke.points.length >= 2) ctx.lineTo(end.x, end.y);
      ctx.stroke();
      // Edge darkening for ink build-up at borders
      ctx.strokeStyle = hexToRgba(stroke.color, 0.12);
      ctx.lineWidth = hlWidth * 1.05;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const curr = stroke.points[i]; const next = stroke.points[i + 1];
        const mx = (curr.x + next.x) / 2, my = (curr.y + next.y) / 2;
        ctx.quadraticCurveTo(curr.x, curr.y, mx, my);
      }
      if (stroke.points.length >= 2) ctx.lineTo(end.x, end.y);
      ctx.stroke();
      // Subtle center saturation boost
      ctx.strokeStyle = hexToRgba(stroke.color, 0.1);
      ctx.lineWidth = hlWidth * 0.5;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const curr = stroke.points[i]; const next = stroke.points[i + 1];
        const mx = (curr.x + next.x) / 2, my = (curr.y + next.y) / 2;
        ctx.quadraticCurveTo(curr.x, curr.y, mx, my);
      }
      if (stroke.points.length >= 2) ctx.lineTo(end.x, end.y);
      ctx.stroke();
      break;
    }
    case 'calligraphy': {
      ctx.strokeStyle = stroke.color;
      // Build continuous paths for main and secondary strokes to avoid gaps
      const mainPath: {x: number, y: number}[] = [];
      const subPath: {x: number, y: number}[] = [];
      let avgWidth = stroke.width * 1.5;
      let totalSpeed = 0;
      for (let i = 1; i < stroke.points.length; i++) {
        const prev = stroke.points[i - 1]; const curr = stroke.points[i];
        const dx = curr.x - prev.x; const dy = curr.y - prev.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const dt = (curr.timestamp && prev.timestamp) ? Math.max(1, curr.timestamp - prev.timestamp) : 16;
        const speedFactor = Math.max(0.2, Math.min(1, 1 - (dist / dt) * 0.15));
        totalSpeed += speedFactor;
        const angle = Math.atan2(dy, dx);
        const nibOffset = Math.abs(Math.sin(angle)) * stroke.width * 0.3;
        mainPath.push({x: curr.x, y: curr.y - nibOffset});
        subPath.push({x: curr.x, y: curr.y + nibOffset});
      }
      avgWidth *= Math.max(0.3, stroke.points[0].pressure) * (totalSpeed / Math.max(1, stroke.points.length - 1));
      // Main stroke
      ctx.lineWidth = avgWidth;
      ctx.beginPath(); ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 0; i < mainPath.length - 1; i++) {
        const curr = mainPath[i]; const next = mainPath[i + 1];
        ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
      }
      if (mainPath.length > 0) ctx.lineTo(mainPath[mainPath.length - 1].x, mainPath[mainPath.length - 1].y);
      ctx.stroke();
      // Sub stroke
      ctx.lineWidth = avgWidth * 0.3;
      ctx.beginPath(); ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 0; i < subPath.length - 1; i++) {
        const curr = subPath[i]; const next = subPath[i + 1];
        ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
      }
      if (subPath.length > 0) ctx.lineTo(subPath[subPath.length - 1].x, subPath[subPath.length - 1].y);
      ctx.stroke();
      break;
    }
    case 'spray': {
      ctx.fillStyle = stroke.color;
      const radius = stroke.width * 2;
      const density = Math.max(5, Math.floor(stroke.width * 1.5));
      for (let i = 0; i < stroke.points.length; i++) {
        const p = stroke.points[i];
        const rng = seededRandom(Math.floor(p.x * 1000 + p.y * 7 + i * 13));
        for (let j = 0; j < density; j++) {
          const a = rng() * Math.PI * 2; const r = rng() * radius;
          ctx.globalAlpha = 0.3 + rng() * 0.5;
          ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, Math.max(0.5, rng() * 1.5), 0, Math.PI * 2); ctx.fill();
        }
      }
      break;
    }
    case 'fountain': {
      ctx.strokeStyle = stroke.color;
      // Use overlapping segments to eliminate gaps
      const segSize = 8; // points per segment
      for (let seg = 0; seg < stroke.points.length - 1; seg += Math.max(1, segSize - 2)) {
        const segEnd = Math.min(seg + segSize, stroke.points.length - 1);
        if (segEnd <= seg) break;
        // Calculate average pressure/direction for this segment
        let avgPressure = 0, avgDownFactor = 0;
        for (let i = seg; i <= segEnd; i++) {
          avgPressure += stroke.points[i].pressure;
          if (i > 0) {
            const dy = stroke.points[i].y - stroke.points[i - 1].y;
            avgDownFactor += Math.max(0.3, Math.min(1.5, 0.5 + (dy > 0 ? dy * 0.05 : dy * 0.02)));
          } else avgDownFactor += 0.7;
        }
        const count = segEnd - seg + 1;
        avgPressure = Math.max(0.15, avgPressure / count);
        avgDownFactor = avgDownFactor / count;
        ctx.lineWidth = stroke.width * 1.8 * avgPressure * avgDownFactor;
        ctx.beginPath();
        ctx.moveTo(stroke.points[seg].x, stroke.points[seg].y);
        for (let i = seg + 1; i < segEnd; i++) {
          const curr = stroke.points[i]; const next = stroke.points[i + 1];
          ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
        }
        ctx.lineTo(stroke.points[segEnd].x, stroke.points[segEnd].y);
        ctx.stroke();
      }
      // Ink dots at endpoints
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(start.x, start.y, stroke.width * 0.5, 0, Math.PI * 2); ctx.fillStyle = stroke.color; ctx.fill();
      ctx.beginPath(); ctx.arc(end.x, end.y, stroke.width * 0.35, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'crayon': {
      ctx.strokeStyle = stroke.color;
      const rng2 = seededRandom(Math.floor(start.x * 100 + start.y * 7));
      for (let i = 1; i < stroke.points.length; i++) {
        const prev = stroke.points[i - 1]; const curr = stroke.points[i];
        const w = stroke.width * 1.8 * Math.max(0.4, curr.pressure);
        for (let t = 0; t < 3; t++) {
          const ox = (rng2() - 0.5) * w * 0.6;
          const oy = (rng2() - 0.5) * w * 0.6;
          ctx.globalAlpha = 0.2 + rng2() * 0.35;
          ctx.lineWidth = w * (0.3 + rng2() * 0.4);
          ctx.beginPath();
          ctx.moveTo(prev.x + ox, prev.y + oy);
          ctx.lineTo(curr.x + ox, curr.y + oy);
          ctx.stroke();
        }
      }
      break;
    }
    case 'watercolor': {
      const rng3 = seededRandom(Math.floor(start.x * 100 + start.y * 7));
      for (let pass = 0; pass < 3; pass++) {
        ctx.strokeStyle = stroke.color;
        ctx.globalAlpha = 0.08 + pass * 0.04;
        ctx.lineWidth = stroke.width * (4 - pass * 0.8);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(start.x + (rng3() - 0.5) * 3, start.y + (rng3() - 0.5) * 3);
        for (let i = 1; i < stroke.points.length; i++) {
          const p = stroke.points[i];
          const jx = (rng3() - 0.5) * 2 * (3 - pass);
          const jy = (rng3() - 0.5) * 2 * (3 - pass);
          ctx.lineTo(p.x + jx, p.y + jy);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 0.15;
      ctx.lineWidth = stroke.width * 0.8;
      ctx.beginPath(); ctx.moveTo(start.x, start.y);
      for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      ctx.stroke();
      break;
    }
    case 'dotpen': {
      ctx.fillStyle = stroke.color;
      const spacing = Math.max(stroke.width * 1.5, 4);
      let accumulated = 0;
      for (let i = 1; i < stroke.points.length; i++) {
        const prev = stroke.points[i - 1]; const curr = stroke.points[i];
        const dx = curr.x - prev.x; const dy = curr.y - prev.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        accumulated += dist;
        while (accumulated >= spacing) {
          const ratio = 1 - (accumulated - spacing) / dist;
          const px = prev.x + dx * ratio;
          const py = prev.y + dy * ratio;
          const r = stroke.width * 0.5 * Math.max(0.3, curr.pressure);
          ctx.globalAlpha = 0.8;
          ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
          accumulated -= spacing;
        }
      }
      break;
    }
    case 'neon': {
      // Neon glow pen: multi-layer glow effect with bright core
      const neonW = stroke.width * 1.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Outer glow (widest, most transparent)
      ctx.shadowColor = stroke.color;
      ctx.shadowBlur = neonW * 6;
      ctx.strokeStyle = hexToRgba(stroke.color, 0.15);
      ctx.lineWidth = neonW * 4;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const curr = stroke.points[i]; const next = stroke.points[i + 1];
        ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
      }
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      // Mid glow
      ctx.shadowBlur = neonW * 3;
      ctx.strokeStyle = hexToRgba(stroke.color, 0.4);
      ctx.lineWidth = neonW * 2;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const curr = stroke.points[i]; const next = stroke.points[i + 1];
        ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
      }
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      // Bright core
      ctx.shadowBlur = neonW * 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = neonW * 0.6;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const curr = stroke.points[i]; const next = stroke.points[i + 1];
        ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
      }
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      // Inner bright color line
      ctx.shadowBlur = 0;
      ctx.strokeStyle = hexToRgba(stroke.color, 0.9);
      ctx.lineWidth = neonW * 0.9;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const curr = stroke.points[i]; const next = stroke.points[i + 1];
        ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
      }
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
};

// --- Draw selection box ---

const drawSelectionBox = (ctx: CanvasRenderingContext2D, bbox: BBox, rotation: number, zoom: number) => {
  ctx.save();
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.translate(-cx, -cy);

  // Dashed border
  ctx.strokeStyle = 'hsl(210 100% 50%)';
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([6 / zoom, 4 / zoom]);
  ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);
  ctx.setLineDash([]);

  // Corner handles
  const hs = HANDLE_SIZE / zoom;
  const corners: [number, number][] = [
    [bbox.x, bbox.y], [bbox.x + bbox.w, bbox.y],
    [bbox.x, bbox.y + bbox.h], [bbox.x + bbox.w, bbox.y + bbox.h],
  ];
  for (const [x, y] of corners) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - hs / 2, y - hs / 2, hs, hs);
    ctx.strokeStyle = 'hsl(210 100% 50%)';
    ctx.lineWidth = 1.5 / zoom;
    ctx.strokeRect(x - hs / 2, y - hs / 2, hs, hs);
  }

  // Rotate handle
  const rotX = bbox.x + bbox.w / 2;
  const rotY = bbox.y - 24 / zoom;
  // Line from top center to rotate handle
  ctx.strokeStyle = 'hsl(210 100% 50%)';
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath(); ctx.moveTo(bbox.x + bbox.w / 2, bbox.y); ctx.lineTo(rotX, rotY); ctx.stroke();
  // Rotate circle
  ctx.beginPath(); ctx.arc(rotX, rotY, hs * 0.7, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.strokeStyle = 'hsl(210 100% 50%)'; ctx.lineWidth = 1.5 / zoom; ctx.stroke();
  // Arrow icon in rotate handle
  ctx.beginPath();
  ctx.arc(rotX, rotY, hs * 0.4, -Math.PI * 0.7, Math.PI * 0.3);
  ctx.strokeStyle = 'hsl(210 100% 50%)'; ctx.lineWidth = 1 / zoom; ctx.stroke();

  ctx.restore();
};

// --- SVG generation ---

const strokeToSvgPath = (stroke: Stroke): string => {
  if (stroke.points.length < 1 || stroke.tool === 'eraser' || stroke.tool === 'select') return '';
  const pts = stroke.points;

  if (isShapeTool(stroke.tool) && pts.length >= 2) {
    const s = pts[0], e = pts[pts.length - 1];
    switch (stroke.tool) {
      case 'line': return `<line x1="${s.x}" y1="${s.y}" x2="${e.x}" y2="${e.y}" stroke="${stroke.color}" stroke-width="${stroke.width}" stroke-linecap="round"/>`;
      case 'rect': {
        const fill = stroke.fillColor && stroke.fillOpacity ? hexToRgba(stroke.fillColor, stroke.fillOpacity) : 'none';
        return `<rect x="${Math.min(s.x, e.x)}" y="${Math.min(s.y, e.y)}" width="${Math.abs(e.x - s.x)}" height="${Math.abs(e.y - s.y)}" stroke="${stroke.color}" stroke-width="${stroke.width}" fill="${fill}"/>`;
      }
      case 'circle': {
        const rx = Math.abs(e.x - s.x) / 2, ry = Math.abs(e.y - s.y) / 2;
        const cx = s.x + (e.x - s.x) / 2, cy = s.y + (e.y - s.y) / 2;
        const fill = stroke.fillColor && stroke.fillOpacity ? hexToRgba(stroke.fillColor, stroke.fillOpacity) : 'none';
        return `<ellipse cx="${cx}" cy="${cy}" rx="${Math.max(1, rx)}" ry="${Math.max(1, ry)}" stroke="${stroke.color}" stroke-width="${stroke.width}" fill="${fill}"/>`;
      }
      case 'arrow': {
        const angle = Math.atan2(e.y - s.y, e.x - s.x);
        const aSize = Math.max(10, stroke.width * 3);
        const a1x = e.x - aSize * Math.cos(angle - Math.PI / 6), a1y = e.y - aSize * Math.sin(angle - Math.PI / 6);
        const a2x = e.x - aSize * Math.cos(angle + Math.PI / 6), a2y = e.y - aSize * Math.sin(angle + Math.PI / 6);
        return `<line x1="${s.x}" y1="${s.y}" x2="${e.x}" y2="${e.y}" stroke="${stroke.color}" stroke-width="${stroke.width}" stroke-linecap="round"/><line x1="${e.x}" y1="${e.y}" x2="${a1x}" y2="${a1y}" stroke="${stroke.color}" stroke-width="${stroke.width}" stroke-linecap="round"/><line x1="${e.x}" y1="${e.y}" x2="${a2x}" y2="${a2y}" stroke="${stroke.color}" stroke-width="${stroke.width}" stroke-linecap="round"/>`;
      }
      case 'triangle': {
        const mx = (s.x + e.x) / 2;
        const fill = stroke.fillColor && stroke.fillOpacity ? hexToRgba(stroke.fillColor, stroke.fillOpacity) : 'none';
        return `<polygon points="${mx},${s.y} ${e.x},${e.y} ${s.x},${e.y}" stroke="${stroke.color}" stroke-width="${stroke.width}" fill="${fill}" stroke-linejoin="round"/>`;
      }
      case 'diamond': {
        const cx = (s.x + e.x) / 2, cy = (s.y + e.y) / 2;
        const fill = stroke.fillColor && stroke.fillOpacity ? hexToRgba(stroke.fillColor, stroke.fillOpacity) : 'none';
        return `<polygon points="${cx},${s.y} ${e.x},${cy} ${cx},${e.y} ${s.x},${cy}" stroke="${stroke.color}" stroke-width="${stroke.width}" fill="${fill}" stroke-linejoin="round"/>`;
      }
      case 'star': {
        const cx = (s.x + e.x) / 2, cy = (s.y + e.y) / 2;
        const outerR = Math.max(Math.abs(e.x - s.x), Math.abs(e.y - s.y)) / 2;
        const innerR = outerR * 0.4;
        const pts: string[] = [];
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? outerR : innerR;
          const angle = (i * Math.PI / 5) - Math.PI / 2;
          pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
        }
        const fill = stroke.fillColor && stroke.fillOpacity ? hexToRgba(stroke.fillColor, stroke.fillOpacity) : 'none';
        return `<polygon points="${pts.join(' ')}" stroke="${stroke.color}" stroke-width="${stroke.width}" fill="${fill}" stroke-linejoin="round"/>`;
      }
      case 'polygon': {
        const cx = (s.x + e.x) / 2, cy = (s.y + e.y) / 2;
        const r = Math.max(Math.abs(e.x - s.x), Math.abs(e.y - s.y)) / 2;
        const sides = 6;
        const pts: string[] = [];
        for (let i = 0; i < sides; i++) {
          const angle = (i * 2 * Math.PI / sides) - Math.PI / 2;
          pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
        }
        const fill = stroke.fillColor && stroke.fillOpacity ? hexToRgba(stroke.fillColor, stroke.fillOpacity) : 'none';
        return `<polygon points="${pts.join(' ')}" stroke="${stroke.color}" stroke-width="${stroke.width}" fill="${fill}" stroke-linejoin="round"/>`;
      }
      case 'pentagon': {
        const cx = (s.x + e.x) / 2, cy = (s.y + e.y) / 2;
        const r = Math.max(Math.abs(e.x - s.x), Math.abs(e.y - s.y)) / 2;
        const pts: string[] = [];
        for (let i = 0; i < 5; i++) {
          const angle = (i * 2 * Math.PI / 5) - Math.PI / 2;
          pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
        }
        const fill = stroke.fillColor && stroke.fillOpacity ? hexToRgba(stroke.fillColor, stroke.fillOpacity) : 'none';
        return `<polygon points="${pts.join(' ')}" stroke="${stroke.color}" stroke-width="${stroke.width}" fill="${fill}" stroke-linejoin="round"/>`;
      }
      case 'trapezoid': {
        const x = Math.min(s.x, e.x), y = Math.min(s.y, e.y);
        const w = Math.abs(e.x - s.x), h = Math.abs(e.y - s.y);
        const inset = w * 0.2;
        const fill = stroke.fillColor && stroke.fillOpacity ? hexToRgba(stroke.fillColor, stroke.fillOpacity) : 'none';
        return `<polygon points="${x+inset},${y} ${x+w-inset},${y} ${x+w},${y+h} ${x},${y+h}" stroke="${stroke.color}" stroke-width="${stroke.width}" fill="${fill}" stroke-linejoin="round"/>`;
      }
      case 'heart':
      case 'moon':
      case 'cloud':
      case 'speechBubble':
      case 'cylinder':
      case 'cone': {
        // Complex shapes: fallback to path-based SVG
        const fill = stroke.fillColor && stroke.fillOpacity ? hexToRgba(stroke.fillColor, stroke.fillOpacity) : 'none';
        return `<rect x="${Math.min(s.x,e.x)}" y="${Math.min(s.y,e.y)}" width="${Math.abs(e.x-s.x)}" height="${Math.abs(e.y-s.y)}" stroke="${stroke.color}" stroke-width="${stroke.width}" fill="${fill}" rx="4" opacity="0.8"/>`;
      }
    }
  }

  if (pts.length < 2 && stroke.tool !== 'spray') return '';

  if (stroke.tool === 'spray') {
    let circles = '';
    const radius = stroke.width * 2;
    const density = Math.max(5, Math.floor(stroke.width * 1.5));
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const rng = seededRandom(Math.floor(p.x * 1000 + p.y * 7 + i * 13));
      for (let j = 0; j < density; j++) {
        const a = rng() * Math.PI * 2, r = rng() * radius;
        const opacity = 0.3 + rng() * 0.5;
        circles += `<circle cx="${p.x + Math.cos(a) * r}" cy="${p.y + Math.sin(a) * r}" r="${Math.max(0.5, rng() * 1.5)}" fill="${stroke.color}" opacity="${opacity.toFixed(2)}"/>`;
      }
    }
    return circles;
  }

  // Freehand path
  let d = `M ${pts[0].x} ${pts[0].y}`;
  if (pts.length === 2) {
    d += ` L ${pts[1].x} ${pts[1].y}`;
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const curr = pts[i], next = pts[i + 1];
      d += ` Q ${curr.x} ${curr.y} ${(curr.x + next.x) / 2} ${(curr.y + next.y) / 2}`;
    }
    d += ` L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  }

  let opacity = '1';
  let color = stroke.color;
  if (stroke.tool === 'highlighter') opacity = '0.25';
  else if (stroke.tool === 'marker') opacity = '0.4';

  const sw = stroke.tool === 'marker' ? stroke.width * 3 : stroke.tool === 'highlighter' ? stroke.width * 4 : stroke.width;

  return `<path d="${d}" stroke="${color}" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;
};

const generateSvg = (layers: Layer[], w: number, h: number, bg: BackgroundType): string => {
  const bgColor = bg === 'dark' ? '#1a1a2e' : '#ffffff';
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  svg += `<rect width="${w}" height="${h}" fill="${bgColor}"/>`;

  for (const layer of layers) {
    if (!layer.visible) continue;
    svg += `<g opacity="${layer.opacity}">`;
    for (const stroke of layer.strokes) {
      svg += strokeToSvgPath(stroke);
    }
    for (const ta of (layer.textAnnotations || [])) {
      const style = `${ta.italic ? 'italic ' : ''}${ta.bold ? 'bold ' : ''}${ta.fontSize}px ${ta.font}`;
      const lines = ta.text.split('\n');
      for (let li = 0; li < lines.length; li++) {
        const escaped = lines[li].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        svg += `<text x="${ta.x}" y="${ta.y + li * ta.fontSize * 1.2 + ta.fontSize}" fill="${ta.color}" font="${style}" style="font: ${style}">${escaped}</text>`;
      }
    }
    svg += '</g>';
  }
  svg += '</svg>';
  return svg;
};

// --- Minimap Component ---

const MINIMAP_W = 120;
const MINIMAP_H = 80;

const MiniMap = memo(({
  layersRef, zoomRef, panRef, canvasSizeRef, zoomDisplay,
  onPanChange, onResetZoom,
}: {
  layersRef: React.RefObject<Layer[]>;
  zoomRef: React.RefObject<number>;
  panRef: React.RefObject<{ x: number; y: number }>;
  canvasSizeRef: React.RefObject<{ w: number; h: number }>;
  zoomDisplay: number;
  onPanChange: (pan: { x: number; y: number }) => void;
  onResetZoom: () => void;
}) => {
  const miniRef = useRef<HTMLCanvasElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const canvas = miniRef.current;
    if (!canvas || collapsed) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = MINIMAP_W * dpr;
    canvas.height = MINIMAP_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);

    // Gather all stroke bounding points
    const allPoints: { x: number; y: number }[] = [];
    for (const layer of layersRef.current) {
      if (!layer.visible) continue;
      for (const s of layer.strokes) {
        for (const p of s.points) allPoints.push(p);
      }
    }

    const zoom = zoomRef.current;
    const pan = panRef.current;
    const { w, h } = canvasSizeRef.current;

    // Viewport in world coords
    const vx0 = -pan.x / zoom;
    const vy0 = -pan.y / zoom;
    const vx1 = vx0 + w / zoom;
    const vy1 = vy0 + h / zoom;

    // World bounds = union of strokes + viewport
    let wx0 = vx0, wy0 = vy0, wx1 = vx1, wy1 = vy1;
    for (const p of allPoints) {
      if (p.x < wx0) wx0 = p.x;
      if (p.y < wy0) wy0 = p.y;
      if (p.x > wx1) wx1 = p.x;
      if (p.y > wy1) wy1 = p.y;
    }

    // Add padding
    const pad = 50;
    wx0 -= pad; wy0 -= pad; wx1 += pad; wy1 += pad;
    const worldW = wx1 - wx0 || 1;
    const worldH = wy1 - wy0 || 1;

    // Scale to fit minimap
    const scale = Math.min(MINIMAP_W / worldW, MINIMAP_H / worldH);
    const offX = (MINIMAP_W - worldW * scale) / 2;
    const offY = (MINIMAP_H - worldH * scale) / 2;

    // Background
    ctx.fillStyle = 'hsl(var(--muted))';
    ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);

    // Draw strokes as simplified lines
    ctx.save();
    ctx.translate(offX, offY);
    for (const layer of layersRef.current) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity * 0.8;
      for (const s of layer.strokes) {
        if (s.points.length === 0) continue;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = Math.max(0.5, s.width * scale * 0.3);
        ctx.beginPath();
        const p0 = s.points[0];
        ctx.moveTo((p0.x - wx0) * scale, (p0.y - wy0) * scale);
        for (let i = 1; i < s.points.length; i++) {
          const p = s.points[i];
          ctx.lineTo((p.x - wx0) * scale, (p.y - wy0) * scale);
        }
        ctx.stroke();
      }
    }
    ctx.restore();

    // Draw viewport rectangle
    const rvx = offX + (vx0 - wx0) * scale;
    const rvy = offY + (vy0 - wy0) * scale;
    const rvw = (vx1 - vx0) * scale;
    const rvh = (vy1 - vy0) * scale;

    ctx.strokeStyle = 'hsl(var(--primary))';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rvx, rvy, rvw, rvh);
    ctx.fillStyle = 'hsl(var(--primary) / 0.08)';
    ctx.fillRect(rvx, rvy, rvw, rvh);
  });

  const handleMinimapClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = miniRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (MINIMAP_W / rect.width);
    const my = (e.clientY - rect.top) * (MINIMAP_H / rect.height);

    const allPoints: { x: number; y: number }[] = [];
    for (const layer of layersRef.current) {
      if (!layer.visible) continue;
      for (const s of layer.strokes) for (const p of s.points) allPoints.push(p);
    }
    const zoom = zoomRef.current;
    const pan = panRef.current;
    const { w, h } = canvasSizeRef.current;
    const vx0 = -pan.x / zoom; const vy0 = -pan.y / zoom;
    const vx1 = vx0 + w / zoom; const vy1 = vy0 + h / zoom;
    let wx0 = vx0, wy0 = vy0, wx1 = vx1, wy1 = vy1;
    for (const p of allPoints) { if (p.x < wx0) wx0 = p.x; if (p.y < wy0) wy0 = p.y; if (p.x > wx1) wx1 = p.x; if (p.y > wy1) wy1 = p.y; }
    const pad = 50;
    wx0 -= pad; wy0 -= pad; wx1 += pad; wy1 += pad;
    const worldW = wx1 - wx0 || 1; const worldH = wy1 - wy0 || 1;
    const scale = Math.min(MINIMAP_W / worldW, MINIMAP_H / worldH);
    const offX = (MINIMAP_W - worldW * scale) / 2;
    const offY = (MINIMAP_H - worldH * scale) / 2;

    const worldX = (mx - offX) / scale + wx0;
    const worldY = (my - offY) / scale + wy0;
    const newPanX = -(worldX * zoom - w / 2);
    const newPanY = -(worldY * zoom - h / 2);
    onPanChange({ x: newPanX, y: newPanY });
  }, [layersRef, zoomRef, panRef, canvasSizeRef, onPanChange]);

  if (collapsed) {
    return (
      <div className="absolute top-2 right-2 flex gap-1">
        <button
          onClick={() => setCollapsed(false)}
          className="bg-card/90 backdrop-blur-sm border border-border/50 rounded-lg px-2 py-1 text-[10px] text-muted-foreground flex items-center gap-1 hover:bg-muted transition-colors"
        >
          <Navigation className="h-3 w-3" />Map
        </button>
        {zoomDisplay !== 100 && (
          <button onClick={onResetZoom}
            className="bg-card/90 backdrop-blur-sm border border-border/50 rounded-lg px-2 py-1 text-[10px] text-muted-foreground flex items-center gap-1 hover:bg-muted transition-colors"
          >
            <Maximize className="h-3 w-3" />{zoomDisplay}%
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="absolute top-2 right-2 bg-card/90 backdrop-blur-sm border border-border/50 rounded-xl overflow-hidden shadow-lg">
      <div className="flex items-center justify-between px-2 py-1 border-b border-border/30">
        <span className="text-[9px] text-muted-foreground font-medium">Navigator</span>
        <div className="flex items-center gap-1">
          {zoomDisplay !== 100 && (
            <button onClick={onResetZoom}
              className="text-[9px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {zoomDisplay}%
            </button>
          )}
          <button onClick={() => setCollapsed(true)} className="text-muted-foreground hover:text-foreground transition-colors">
            <Minus className="h-3 w-3" />
          </button>
        </div>
      </div>
      <canvas
        ref={miniRef}
        width={MINIMAP_W}
        height={MINIMAP_H}
        className="cursor-pointer block"
        style={{ width: MINIMAP_W, height: MINIMAP_H }}
        onClick={handleMinimapClick}
      />
    </div>
  );
});
MiniMap.displayName = 'MiniMap';

// --- Component ---

interface SketchEditorProps {
  initialData?: string;
  onChange: (json: string) => void;
  onImageExport?: (pngDataUrl: string) => void;
  className?: string;
}

// --- Pen Preview Canvas ---
const PenPreviewCanvas = memo(({ penType, isActive, currentColor }: { penType: DrawToolType; isActive: boolean; currentColor: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Generate a wavy S-curve with simulated pressure
    const points: { x: number; y: number; p: number }[] = [];
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = t * w * 0.9 + w * 0.05;
      const y = h / 2 + Math.sin(t * Math.PI * 2) * (h * 0.25);
      // Pressure: ramp up then down
      const p = 0.2 + 0.8 * Math.sin(t * Math.PI);
      points.push({ x, y, p });
    }

    const c = currentColor || '#3C78F0';

    switch (penType) {
      case 'pencil': {
        ctx.strokeStyle = c;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        points.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
        ctx.stroke();
        break;
      }
      case 'pen': {
        ctx.strokeStyle = c;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (let i = 1; i < points.length; i++) {
          ctx.lineWidth = 1 + points[i].p * 2;
          ctx.beginPath();
          ctx.moveTo(points[i - 1].x, points[i - 1].y);
          ctx.lineTo(points[i].x, points[i].y);
          ctx.stroke();
        }
        break;
      }
      case 'fountain': {
        ctx.strokeStyle = c;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (let i = 1; i < points.length; i++) {
          ctx.globalAlpha = 0.7 + points[i].p * 0.3;
          ctx.lineWidth = 0.5 + points[i].p * 3.5;
          ctx.beginPath();
          ctx.moveTo(points[i - 1].x, points[i - 1].y);
          ctx.lineTo(points[i].x, points[i].y);
          ctx.stroke();
        }
        break;
      }
      case 'marker': {
        // Live preview: chisel-tip marker with layered opacity
        ctx.lineJoin = 'miter';
        ctx.lineCap = 'square';
        const liveMarkerW = 4;
        // Base layer
        ctx.strokeStyle = c;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = liveMarkerW;
        ctx.beginPath();
        points.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else {
            const prev = points[i - 1];
            const mx = (prev.x + pt.x) / 2, my = (prev.y + pt.y) / 2;
            ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
          }
        });
        ctx.stroke();
        // Center highlight
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = liveMarkerW * 0.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        points.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else {
            const prev = points[i - 1];
            const mx = (prev.x + pt.x) / 2, my = (prev.y + pt.y) / 2;
            ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
          }
        });
        ctx.stroke();
        break;
      }
      case 'highlighter': {
        // Live preview: flat transparent band with multiply blend
        ctx.globalCompositeOperation = 'multiply';
        ctx.lineJoin = 'bevel';
        ctx.lineCap = 'butt';
        const liveHlW = 8;
        ctx.strokeStyle = c;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = liveHlW;
        ctx.beginPath();
        points.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else {
            const prev = points[i - 1];
            const mx = (prev.x + pt.x) / 2, my = (prev.y + pt.y) / 2;
            ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
          }
        });
        ctx.stroke();
        // Subtle center boost
        ctx.globalAlpha = 0.1;
        ctx.lineWidth = liveHlW * 0.5;
        ctx.beginPath();
        points.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else {
            const prev = points[i - 1];
            const mx = (prev.x + pt.x) / 2, my = (prev.y + pt.y) / 2;
            ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
          }
        });
        ctx.stroke();
        break;
      }
      case 'calligraphy': {
        ctx.fillStyle = c;
        ctx.globalAlpha = 0.9;
        for (let i = 1; i < points.length; i++) {
          const dx = points[i].x - points[i - 1].x;
          const dy = points[i].y - points[i - 1].y;
          const angle = Math.atan2(dy, dx);
          const width = 1 + points[i].p * 3;
          const nx = Math.cos(angle + Math.PI / 2) * width / 2;
          const ny = Math.sin(angle + Math.PI / 2) * width / 2;
          ctx.beginPath();
          ctx.moveTo(points[i - 1].x - nx, points[i - 1].y - ny);
          ctx.lineTo(points[i - 1].x + nx, points[i - 1].y + ny);
          ctx.lineTo(points[i].x + nx, points[i].y + ny);
          ctx.lineTo(points[i].x - nx, points[i].y - ny);
          ctx.fill();
        }
        break;
      }
      case 'crayon': {
        ctx.strokeStyle = c;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = 3;
        for (let i = 1; i < points.length; i++) {
          ctx.globalAlpha = 0.3 + Math.random() * 0.4;
          ctx.beginPath();
          ctx.moveTo(points[i - 1].x + (Math.random() - 0.5) * 2, points[i - 1].y + (Math.random() - 0.5) * 2);
          ctx.lineTo(points[i].x + (Math.random() - 0.5) * 2, points[i].y + (Math.random() - 0.5) * 2);
          ctx.stroke();
        }
        break;
      }
      case 'watercolor': {
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (let pass = 0; pass < 3; pass++) {
          ctx.strokeStyle = c;
          ctx.globalAlpha = 0.1;
          ctx.lineWidth = 5 + pass * 2;
          ctx.beginPath();
          points.forEach((pt, i) => {
            const ox = (Math.random() - 0.5) * 2 * pass;
            const oy = (Math.random() - 0.5) * 2 * pass;
            i === 0 ? ctx.moveTo(pt.x + ox, pt.y + oy) : ctx.lineTo(pt.x + ox, pt.y + oy);
          });
          ctx.stroke();
        }
        break;
      }
      case 'spray': {
        ctx.fillStyle = c;
        for (const pt of points) {
          const density = Math.floor(3 + pt.p * 5);
          const radius = 3 + pt.p * 3;
          for (let j = 0; j < density; j++) {
            const angle = Math.random() * Math.PI * 2;
            const r = Math.random() * radius;
            ctx.globalAlpha = 0.3 + Math.random() * 0.4;
            ctx.beginPath();
            ctx.arc(pt.x + Math.cos(angle) * r, pt.y + Math.sin(angle) * r, 0.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      }
      case 'dotpen': {
        ctx.fillStyle = c;
        ctx.globalAlpha = 0.9;
        for (let i = 0; i < points.length; i += 3) {
          const pt = points[i];
          const r = 0.8 + pt.p * 1.5;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'neon': {
        // Preview: neon glow with shadow
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = c;
        ctx.shadowBlur = 8;
        ctx.strokeStyle = c;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 5;
        ctx.beginPath();
        points.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else {
            const prev = points[i - 1];
            ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + pt.x) / 2, (prev.y + pt.y) / 2);
          }
        });
        ctx.stroke();
        // White core
        ctx.shadowBlur = 4;
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        points.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else {
            const prev = points[i - 1];
            ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + pt.x) / 2, (prev.y + pt.y) / 2);
          }
        });
        ctx.stroke();
        break;
      }
    }
  }, [penType, currentColor]);

  return (
    <canvas
      ref={canvasRef}
      width={120}
      height={32}
      className={cn(
        'rounded-lg w-full h-8',
        isActive ? 'bg-primary/5' : 'bg-muted/40'
      )}
    />
  );
});
PenPreviewCanvas.displayName = 'PenPreviewCanvas';

export const SketchEditor = memo(({ initialData, onChange, onImageExport, className }: SketchEditorProps) => {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [tool, setTool] = useState<ToolType>('pen');
  const [color, setColor] = useState('#1a1a1a');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [toolOpacity, setToolOpacity] = useState(1);
  const [activeLayerId, setActiveLayerId] = useState(1);
  const [background, setBackground] = useState<BackgroundType>('grid-sm');
  const [recentColors, setRecentColors] = useState<string[]>(['#1a1a1a']);
  const [eyedropperActive, setEyedropperActive] = useState(false);
  const [, forceUpdate] = useState(0);

  // HSL state
  const [hslH, setHslH] = useState(0);
  const [hslS, setHslS] = useState(0);
  const [hslL, setHslL] = useState(0.1);

  // Grid snap state
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [gridColor, setGridColor] = useState('#8c8c8c');
  const [gridOpacity, setGridOpacity] = useState(0.45);

  // Focus mode & ruler state
  const [focusMode, setFocusMode] = useState(false);
  const [showRulers, setShowRulers] = useState(false);

  // Fill color state for shapes
  const [fillEnabled, setFillEnabled] = useState(false);
  const [fillColor, setFillColor] = useState('#3b82f6');
  const [fillOpacity, setFillOpacity] = useState(0.3);

  // Color palette manager state
  const [savedPalettes, setSavedPalettes] = useState<{ name: string; colors: string[] }[]>(() => {
    try {
      const stored = localStorage.getItem('sketch-color-palettes');
      return stored ? JSON.parse(stored) : [
        { name: 'Default', colors: ['#1a1a1a', '#ffffff', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'] },
        { name: 'Pastel', colors: ['#fecdd3', '#fed7aa', '#fef08a', '#bbf7d0', '#bfdbfe', '#ddd6fe', '#fbcfe8', '#e2e8f0'] },
        { name: 'Earth', colors: ['#292524', '#78716c', '#a16207', '#854d0e', '#365314', '#1e3a5f', '#44403c', '#d6d3d1'] },
      ];
    } catch { return []; }
  });
  const [activePaletteIdx, setActivePaletteIdx] = useState(0);
  const [newPaletteName, setNewPaletteName] = useState('');

  // Timelapse state
  const [isPlayingTimelapse, setIsPlayingTimelapse] = useState(false);
  const timelapseAbortRef = useRef(false);

  // SVG import ref
  const svgInputRef = useRef<HTMLInputElement>(null);

  // Selection state
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [selectionRotation, setSelectionRotation] = useState(0);
  const selectionActionRef = useRef<{
    type: HandleType;
    startPos: { x: number; y: number };
    origBBox: BBox;
    origStrokes: Stroke[];
    origRotation: number;
  } | null>(null);
  const clipboardRef = useRef<Stroke[]>([]);

  // Text tool state
  const [textFont, setTextFont] = useState('sans-serif');
  const [textFontSize, setTextFontSize] = useState(24);
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);
  const [editingText, setEditingText] = useState<{ x: number; y: number; annotationId?: number } | null>(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const nextTextIdRef = useRef(1);

  // Sticky note state
  const [stickyColor, setStickyColor] = useState('#FEF3C7');
  const [editingStickyId, setEditingStickyId] = useState<number | null>(null);
  const [editingStickyText, setEditingStickyText] = useState('');
  const [selectedStickyId, setSelectedStickyId] = useState<number | null>(null);
  const stickyInputRef = useRef<HTMLTextAreaElement>(null);
  const nextStickyIdRef = useRef(1);
  
  const stickyDragRef = useRef<{
    noteId: number;
    startX: number; startY: number;
    origX: number; origY: number;
    type: 'move' | 'resize' | 'rotate';
    origW?: number; origH?: number;
    handle?: 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r';
    origRotation?: number;
  } | null>(null);
  const stickyLastTapRef = useRef<{ time: number; id: number }>({ time: 0, id: -1 });

  // Image tool state
  const [selectedImageId, setSelectedImageId] = useState<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const nextImageIdRef = useRef(1);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const imageDragRef = useRef<{
    imageId: number;
    startX: number; startY: number;
    origX: number; origY: number;
    type: 'move' | 'resize';
    origW?: number; origH?: number;
    handle?: 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r';
  } | null>(null);

  // Marquee selection state
  const marqueeRef = useRef<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);

  const layersRef = useRef<Layer[]>(createDefaultLayers());
  const undoStackRef = useRef<Layer[][]>([]);
  const redoStackRef = useRef<Layer[][]>([]);

  const isDrawingRef = useRef(false);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const lastPointRef = useRef<Point | null>(null);
  const currentPressureRef = useRef(0);
  const [showPressure, setShowPressure] = useState(false);
  const [pressureValue, setPressureValue] = useState(0);
  const rafRef = useRef<number>(0);
  const canvasSizeRef = useRef({ w: 0, h: 0 });


  // Zoom & pan state
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const [zoomDisplay, setZoomDisplay] = useState(100);

  // Multi-touch gesture tracking
  const activeTouchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureStateRef = useRef<{
    isPinching: boolean;
    initialDist: number;
    initialZoom: number;
    initialPan: { x: number; y: number };
    initialMid: { x: number; y: number };
  } | null>(null);
  const lastTapRef = useRef(0);

  const cloneLayers = (layers: Layer[]): Layer[] =>
    layers.map(l => ({ ...l, strokes: l.strokes.map(s => ({ ...s, points: [...s.points] })), textAnnotations: [...(l.textAnnotations || [])], stickyNotes: (l.stickyNotes || []).map(sn => ({ ...sn })), images: (l.images || []).map(img => ({ ...img })) }));

  // --- Image loading cache ---
  const redrawRef = useRef<() => void>(() => {});
  const emitChangeRef = useRef<() => void>(() => {});
  const getOrLoadImage = useCallback((src: string): HTMLImageElement | null => {
    const cached = imageCacheRef.current.get(src);
    if (cached && cached.complete) return cached;
    if (!cached) {
      const img = new window.Image();
      img.onload = () => { redrawRef.current(); };
      img.src = src;
      imageCacheRef.current.set(src, img);
    }
    return null;
  }, []);

  const handleImageUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const img = new window.Image();
      img.onload = () => {
        imageCacheRef.current.set(dataUrl, img);
        const layer = layersRef.current.find(l => l.id === activeLayerId);
        if (!layer) return;
        undoStackRef.current = [...undoStackRef.current.slice(-(MAX_UNDO - 1)), cloneLayers(layersRef.current)];
        redoStackRef.current = [];
        if (!layer.images) layer.images = [];
        const maxDim = 300;
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        const zoom = zoomRef.current;
        const pan = panRef.current;
        const cw = canvasSizeRef.current.w;
        const ch = canvasSizeRef.current.h;
        const cx = (cw / 2 - pan.x) / zoom;
        const cy = (ch / 2 - pan.y) / zoom;
        const newImg: CanvasImageData = {
          id: nextImageIdRef.current++,
          x: cx - w / 2,
          y: cy - h / 2,
          width: w,
          height: h,
          src: dataUrl,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        };
        layer.images.push(newImg);
        setSelectedImageId(newImg.id);
        setTool('select');
        forceUpdate(n => n + 1);
        redrawRef.current();
        emitChangeRef.current();
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }, [activeLayerId]);

  // --- Color helpers ---

  const addToRecent = useCallback((c: string) => {
    setRecentColors(prev => {
      const filtered = prev.filter(rc => rc !== c);
      return [c, ...filtered].slice(0, MAX_RECENT_COLORS);
    });
  }, []);

  const applyColor = useCallback((c: string) => {
    setColor(c);
    const [h, s, l] = hexToHsl(c);
    setHslH(h); setHslS(s); setHslL(l);
    addToRecent(c);
  }, [addToRecent]);

  const handleHslChange = useCallback((h: number, s: number, l: number) => {
    const hex = hslToHex(h, s, l);
    setColor(hex); setHslH(h); setHslS(s); setHslL(l);
  }, []);

  // --- Selection helpers ---

  const getSelectedStrokes = useCallback((): Stroke[] => {
    const layer = layersRef.current.find(l => l.id === activeLayerId);
    if (!layer) return [];
    return selectedIndices.map(i => layer.strokes[i]).filter(Boolean);
  }, [selectedIndices, activeLayerId]);

  const clearSelection = useCallback(() => {
    setSelectedIndices([]);
    setSelectionRotation(0);
    selectionActionRef.current = null;
    setSelectedImageId(null);
    setSelectedStickyId(null);
  }, []);

  // --- Canvas ---

  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { w, h } = canvasSizeRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, w, h);

    const zoom = zoomRef.current;
    const pan = panRef.current;
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw background in world coordinates — infinite canvas
    const vx0 = -pan.x / zoom;
    const vy0 = -pan.y / zoom;
    const vx1 = vx0 + w / zoom;
    const vy1 = vy0 + h / zoom;
    drawBackground(ctx, vx0, vy0, vx1, vy1, background, gridColor, gridOpacity);

    for (const layer of layersRef.current) {
      if (!layer.visible) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      for (const stroke of layer.strokes) drawStroke(ctx, stroke);
      // Draw text annotations
      for (const ta of (layer.textAnnotations || [])) {
        ctx.save();
        const style = `${ta.italic ? 'italic ' : ''}${ta.bold ? 'bold ' : ''}${ta.fontSize}px ${ta.font}`;
        ctx.font = style;
        ctx.fillStyle = ta.color;
        ctx.textBaseline = 'top';
        const lines = ta.text.split('\n');
        for (let li = 0; li < lines.length; li++) {
          ctx.fillText(lines[li], ta.x, ta.y + li * ta.fontSize * 1.2);
        }
        ctx.restore();
      }
      // Draw images
      for (const img of (layer.images || [])) {
        const htmlImg = getOrLoadImage(img.src);
        if (htmlImg) {
          ctx.save();
          ctx.drawImage(htmlImg, img.x, img.y, img.width, img.height);
          // Draw selection handles if selected
          if (img.id === selectedImageId) {
            ctx.strokeStyle = 'hsl(210 100% 50%)';
            ctx.lineWidth = 2 / zoom;
            ctx.setLineDash([6 / zoom, 4 / zoom]);
            ctx.strokeRect(img.x - 2/zoom, img.y - 2/zoom, img.width + 4/zoom, img.height + 4/zoom);
            ctx.setLineDash([]);
            const hs = HANDLE_SIZE / zoom;
            // 8 handles: 4 corners + 4 edges
            const handlePositions = [
              [img.x, img.y], [img.x + img.width / 2, img.y], [img.x + img.width, img.y],
              [img.x, img.y + img.height / 2], [img.x + img.width, img.y + img.height / 2],
              [img.x, img.y + img.height], [img.x + img.width / 2, img.y + img.height], [img.x + img.width, img.y + img.height],
            ];
            for (const [cx2, cy2] of handlePositions) {
              ctx.fillStyle = '#ffffff';
              ctx.strokeStyle = 'hsl(210 100% 50%)';
              ctx.lineWidth = 1.5 / zoom;
              ctx.beginPath();
              ctx.arc(cx2, cy2, hs, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
          }
          ctx.restore();
        }
      }
      // Draw sticky notes
      for (const sn of (layer.stickyNotes || [])) {
        ctx.save();
        // Apply rotation if any
        if (sn.rotation) {
          const cx = sn.x + sn.width / 2;
          const cy = sn.y + sn.height / 2;
          ctx.translate(cx, cy);
          ctx.rotate(sn.rotation);
          ctx.translate(-cx, -cy);
        }
        // Shadow
        ctx.shadowColor = 'rgba(0,0,0,0.15)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 4;
        // Note body
        ctx.fillStyle = sn.color;
        ctx.beginPath();
        ctx.moveTo(sn.x, sn.y);
        ctx.lineTo(sn.x + sn.width, sn.y);
        ctx.lineTo(sn.x + sn.width, sn.y + sn.height);
        ctx.lineTo(sn.x, sn.y + sn.height);
        ctx.closePath();
        ctx.fill();
        // Folded corner
        ctx.shadowColor = 'transparent';
        const foldSize = Math.min(20, sn.width * 0.12, sn.height * 0.12);
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.beginPath();
        ctx.moveTo(sn.x + sn.width - foldSize, sn.y + sn.height);
        ctx.lineTo(sn.x + sn.width, sn.y + sn.height - foldSize);
        ctx.lineTo(sn.x + sn.width, sn.y + sn.height);
        ctx.closePath();
        ctx.fill();
        // Text
        if (sn.text) {
          ctx.fillStyle = '#1a1a1a';
          ctx.font = `${sn.fontSize}px sans-serif`;
          ctx.textBaseline = 'top';
          const padding = 10;
          const maxW = sn.width - padding * 2;
          const words = sn.text.split(/\n/);
          let lineY = sn.y + padding;
          for (const paragraph of words) {
            const pWords = paragraph.split(' ');
            let line = '';
            for (const word of pWords) {
              const test = line ? line + ' ' + word : word;
              if (ctx.measureText(test).width > maxW && line) {
                ctx.fillText(line, sn.x + padding, lineY);
                lineY += sn.fontSize * 1.3;
                line = word;
              } else {
                line = test;
              }
            }
            if (line) {
              ctx.fillText(line, sn.x + padding, lineY);
              lineY += sn.fontSize * 1.3;
            }
          }
        }
        ctx.restore();
        // Draw selection handles if this sticky is selected (8 handles + rotate)
        if (sn.id === selectedStickyId) {
          ctx.save();
          // Apply rotation transform for handles too
          if (sn.rotation) {
            const cx = sn.x + sn.width / 2;
            const cy = sn.y + sn.height / 2;
            ctx.translate(cx, cy);
            ctx.rotate(sn.rotation);
            ctx.translate(-cx, -cy);
          }
          ctx.strokeStyle = 'hsl(210 100% 50%)';
          ctx.lineWidth = 2 / zoom;
          ctx.setLineDash([6 / zoom, 4 / zoom]);
          ctx.strokeRect(sn.x - 2/zoom, sn.y - 2/zoom, sn.width + 4/zoom, sn.height + 4/zoom);
          ctx.setLineDash([]);
          const hs = HANDLE_SIZE / zoom;
          // 8 handles: 4 corners + 4 edges
          const handlePositions = [
            [sn.x, sn.y], [sn.x + sn.width / 2, sn.y], [sn.x + sn.width, sn.y],
            [sn.x, sn.y + sn.height / 2], [sn.x + sn.width, sn.y + sn.height / 2],
            [sn.x, sn.y + sn.height], [sn.x + sn.width / 2, sn.y + sn.height], [sn.x + sn.width, sn.y + sn.height],
          ];
          for (const [cx2, cy2] of handlePositions) {
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = 'hsl(210 100% 50%)';
            ctx.lineWidth = 1.5 / zoom;
            ctx.beginPath();
            ctx.arc(cx2, cy2, hs, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
          // Rotate handle (above top center)
          const rotX = sn.x + sn.width / 2;
          const rotY = sn.y - 24 / zoom;
          ctx.strokeStyle = 'hsl(210 100% 50%)';
          ctx.lineWidth = 1 / zoom;
          ctx.beginPath(); ctx.moveTo(sn.x + sn.width / 2, sn.y); ctx.lineTo(rotX, rotY); ctx.stroke();
          ctx.beginPath(); ctx.arc(rotX, rotY, hs * 0.7, 0, Math.PI * 2);
          ctx.fillStyle = '#fff'; ctx.fill();
          ctx.strokeStyle = 'hsl(210 100% 50%)'; ctx.lineWidth = 1.5 / zoom; ctx.stroke();
          // Arrow icon in rotate handle
          ctx.beginPath();
          ctx.arc(rotX, rotY, hs * 0.4, -Math.PI * 0.7, Math.PI * 0.3);
          ctx.strokeStyle = 'hsl(210 100% 50%)'; ctx.lineWidth = 1 / zoom; ctx.stroke();
          ctx.restore();
        }
      }
      if (layer.id === activeLayerId && currentStrokeRef.current) {
        drawStroke(ctx, currentStrokeRef.current);
      }
      ctx.restore();
    }

    // Draw selection box
    if (selectedIndices.length > 0) {
      const selStrokes = getSelectedStrokes();
      const bbox = getSelectionBBox(selStrokes);
      if (bbox) {
        drawSelectionBox(ctx, bbox, selectionRotation, zoom);
      }
    }

    // Draw marquee rectangle
    if (marqueeRef.current) {
      const m = marqueeRef.current;
      const mx = Math.min(m.startX, m.currentX);
      const my = Math.min(m.startY, m.currentY);
      const mw = Math.abs(m.currentX - m.startX);
      const mh = Math.abs(m.currentY - m.startY);
      if (mw > 2 || mh > 2) {
        ctx.strokeStyle = 'hsl(210 100% 50% / 0.7)';
        ctx.fillStyle = 'hsl(210 100% 50% / 0.08)';
        ctx.lineWidth = 1.5 / zoom;
        ctx.setLineDash([6 / zoom, 4 / zoom]);
        ctx.fillRect(mx, my, mw, mh);
        ctx.strokeRect(mx, my, mw, mh);
        ctx.setLineDash([]);
      }
    }

    ctx.restore();
  }, [activeLayerId, background, selectedIndices, selectionRotation, getSelectedStrokes, selectedStickyId, selectedImageId, gridColor, gridOpacity, getOrLoadImage]);

  // Keep redrawRef in sync
  redrawRef.current = redrawAll;

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(rect.width); const h = Math.floor(rect.height);
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    canvasSizeRef.current = { w, h };
    redrawAll();
  }, [redrawAll]);

  // --- Pointer events ---

  const getPos = (e: PointerEvent): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const zoom = zoomRef.current;
    const pan = panRef.current;
    return {
      x: (screenX - pan.x) / zoom,
      y: (screenY - pan.y) / zoom,
      pressure: e.pressure > 0 ? e.pressure : 0.5,
      timestamp: e.timeStamp,
    };
  };

  const isPalmTouch = (e: PointerEvent): boolean => {
    if (e.pointerType !== 'touch') return false;
    const w = (e as any).width ?? 0;
    const h = (e as any).height ?? 0;
    return w > PALM_REJECTION_RADIUS || h > PALM_REJECTION_RADIUS;
  };

  const onPointerDown = useCallback((e: PointerEvent) => {
    if (isPalmTouch(e)) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    // Eyedropper mode
    if (eyedropperActive) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const dpr = window.devicePixelRatio || 1;
        const px = Math.floor((e.clientX - rect.left) * dpr);
        const py = Math.floor((e.clientY - rect.top) * dpr);
        const pixel = ctx.getImageData(px, py, 1, 1).data;
        const hex = `#${pixel[0].toString(16).padStart(2, '0')}${pixel[1].toString(16).padStart(2, '0')}${pixel[2].toString(16).padStart(2, '0')}`;
        applyColor(hex);
        setEyedropperActive(false);
      }
      return;
    }

    // Touch gesture tracking
    if (e.pointerType === 'touch') {
      activeTouchesRef.current.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });

      if (activeTouchesRef.current.size >= 2) {
        if (isDrawingRef.current) {
          isDrawingRef.current = false;
          currentStrokeRef.current = null;
          lastPointRef.current = null;
          redrawAll();
        }
        const touches = Array.from(activeTouchesRef.current.values());
        const dx = touches[1].x - touches[0].x; const dy = touches[1].y - touches[0].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const midX = (touches[0].x + touches[1].x) / 2; const midY = (touches[0].y + touches[1].y) / 2;
        gestureStateRef.current = {
          isPinching: true, initialDist: dist, initialZoom: zoomRef.current,
          initialPan: { ...panRef.current }, initialMid: { x: midX, y: midY },
        };
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      // Only do global double-tap-to-reset-zoom for draw/eraser tools, not when sticky/select might handle double-tap
      if (tool !== 'sticky' && tool !== 'select') {
        const now = Date.now();
        if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
          zoomRef.current = 1; panRef.current = { x: 0, y: 0 }; setZoomDisplay(100); redrawAll();
          lastTapRef.current = 0; return;
        }
        lastTapRef.current = now;
      }
    }

    if (e.pointerType === 'touch' && isDrawingRef.current) return;

    // --- Text tool logic ---
    if (tool === 'text') {
      const point = getPos(e);
      const layer = layersRef.current.find(l => l.id === activeLayerId);
      if (!layer?.visible) return;

      // Check if tapping on existing text annotation to edit it
      let hitAnnotation: TextAnnotation | null = null;
      for (let i = (layer.textAnnotations || []).length - 1; i >= 0; i--) {
        const ta = layer.textAnnotations[i];
        const lines = ta.text.split('\n');
        const textH = lines.length * ta.fontSize * 1.2;
        // Rough width estimate
        const maxLineW = Math.max(...lines.map(l => l.length * ta.fontSize * 0.6));
        if (point.x >= ta.x && point.x <= ta.x + maxLineW && point.y >= ta.y && point.y <= ta.y + textH) {
          hitAnnotation = ta;
          break;
        }
      }

      if (hitAnnotation) {
        setEditingText({ x: hitAnnotation.x, y: hitAnnotation.y, annotationId: hitAnnotation.id });
        setEditingTextValue(hitAnnotation.text);
        setTextFont(hitAnnotation.font);
        setTextFontSize(hitAnnotation.fontSize);
        setTextBold(hitAnnotation.bold);
        setTextItalic(hitAnnotation.italic);
      } else {
        setEditingText({ x: point.x, y: point.y });
        setEditingTextValue('');
      }
      return;
    }

    // --- Sticky note tool logic ---
    if (tool === 'sticky') {
      const point = getPos(e);
      const layer = layersRef.current.find(l => l.id === activeLayerId);
      if (!layer?.visible) return;
      canvas.setPointerCapture(e.pointerId);

      // Check if tapping on existing sticky note
      for (let i = (layer.stickyNotes || []).length - 1; i >= 0; i--) {
        const sn = layer.stickyNotes[i];
        if (point.x >= sn.x - 10/zoomRef.current && point.x <= sn.x + sn.width + 10/zoomRef.current &&
            point.y >= sn.y - 10/zoomRef.current && point.y <= sn.y + sn.height + 10/zoomRef.current) {
          
          // Check for double-tap to edit
          const now = Date.now();
          if (now - stickyLastTapRef.current.time < DOUBLE_TAP_DELAY && stickyLastTapRef.current.id === sn.id) {
            stickyLastTapRef.current = { time: 0, id: -1 };
            setEditingStickyId(sn.id);
            setEditingStickyText(sn.text);
            return;
          }
          stickyLastTapRef.current = { time: now, id: sn.id };

          // If already selected, check rotate handle first, then resize handles, then body for move
          if (selectedStickyId === sn.id) {
            const ha = 20 / zoomRef.current;
            // Check rotate handle (above top center)
            const rotHX = sn.x + sn.width / 2;
            const rotHY = sn.y - 24 / zoomRef.current;
            if (Math.abs(point.x - rotHX) < ha && Math.abs(point.y - rotHY) < ha) {
              undoStackRef.current = [...undoStackRef.current.slice(-(MAX_UNDO - 1)), cloneLayers(layersRef.current)];
              redoStackRef.current = [];
              stickyDragRef.current = {
                noteId: sn.id, startX: point.x, startY: point.y,
                origX: sn.x, origY: sn.y, type: 'rotate',
                origW: sn.width, origH: sn.height,
                origRotation: sn.rotation || 0,
              };
              redrawAll();
              return;
            }
            type StickyHandleType = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r';
            const handles: { key: StickyHandleType; cx: number; cy: number }[] = [
              { key: 'tl', cx: sn.x, cy: sn.y },
              { key: 't', cx: sn.x + sn.width / 2, cy: sn.y },
              { key: 'tr', cx: sn.x + sn.width, cy: sn.y },
              { key: 'l', cx: sn.x, cy: sn.y + sn.height / 2 },
              { key: 'r', cx: sn.x + sn.width, cy: sn.y + sn.height / 2 },
              { key: 'bl', cx: sn.x, cy: sn.y + sn.height },
              { key: 'b', cx: sn.x + sn.width / 2, cy: sn.y + sn.height },
              { key: 'br', cx: sn.x + sn.width, cy: sn.y + sn.height },
            ];
            let hitHandle: StickyHandleType | null = null;
            for (const h of handles) {
              if (Math.abs(point.x - h.cx) < ha && Math.abs(point.y - h.cy) < ha) {
                hitHandle = h.key;
                break;
              }
            }
            undoStackRef.current = [...undoStackRef.current.slice(-(MAX_UNDO - 1)), cloneLayers(layersRef.current)];
            redoStackRef.current = [];
            if (hitHandle) {
              stickyDragRef.current = {
                noteId: sn.id, startX: point.x, startY: point.y,
                origX: sn.x, origY: sn.y, type: 'resize',
                origW: sn.width, origH: sn.height, handle: hitHandle,
              };
            } else if (point.x >= sn.x && point.x <= sn.x + sn.width &&
                       point.y >= sn.y && point.y <= sn.y + sn.height) {
              stickyDragRef.current = {
                noteId: sn.id, startX: point.x, startY: point.y,
                origX: sn.x, origY: sn.y, type: 'move',
              };
            }
          } else {
            // Single click: select the sticky note
            setSelectedStickyId(sn.id);
          }
          redrawAll();
          return;
        }
      }

      // Tapped empty space: deselect any sticky
      if (selectedStickyId != null) {
        setSelectedStickyId(null);
        redrawAll();
        return;
      }

      // Create new sticky note
      undoStackRef.current = [...undoStackRef.current.slice(-(MAX_UNDO - 1)), cloneLayers(layersRef.current)];
      redoStackRef.current = [];
      if (!layer.stickyNotes) layer.stickyNotes = [];
      const newNote: StickyNoteData = {
        id: nextStickyIdRef.current++,
        x: point.x - 75,
        y: point.y - 75,
        width: 150,
        height: 150,
        text: '',
        color: stickyColor,
        fontSize: 14,
      };
      layer.stickyNotes.push(newNote);
      // Auto-select the new note
      setSelectedStickyId(newNote.id);
      setEditingStickyText('');
      forceUpdate(n => n + 1);
      redrawAll();
      emitChange();
      return;
    }

    // --- Image tool logic ---
    if (tool === 'image') {
      imageInputRef.current?.click();
      return;
    }

    // --- Select tool logic ---
    if (tool === 'select') {
      const point = getPos(e);
      const layer = layersRef.current.find(l => l.id === activeLayerId);
      if (!layer?.visible) return;
      canvas.setPointerCapture(e.pointerId);

      // Check if clicking on existing selection handles
      if (selectedIndices.length > 0) {
        const selStrokes = selectedIndices.map(i => layer.strokes[i]).filter(Boolean);
        const bbox = getSelectionBBox(selStrokes);
        if (bbox) {
          const handle = hitTestHandle(point.x, point.y, bbox, zoomRef.current);
          if (handle) {
            selectionActionRef.current = {
              type: handle,
              startPos: { x: point.x, y: point.y },
              origBBox: { ...bbox },
              origStrokes: cloneStrokes(selStrokes),
              origRotation: selectionRotation,
            };
            // Push undo snapshot
            undoStackRef.current = [
              ...undoStackRef.current.slice(-(MAX_UNDO - 1)),
              cloneLayers(layersRef.current),
            ];
            redoStackRef.current = [];
            return;
          }
        }
      }

      // Hit test sticky notes first (back to front) - single click selects, double click edits
      for (let i = (layer.stickyNotes || []).length - 1; i >= 0; i--) {
        const sn = layer.stickyNotes[i];
        if (point.x >= sn.x - 10/zoomRef.current && point.x <= sn.x + sn.width + 10/zoomRef.current &&
            point.y >= sn.y - 10/zoomRef.current && point.y <= sn.y + sn.height + 10/zoomRef.current) {
          
          // Check for double-tap to edit
          const now = Date.now();
          if (now - stickyLastTapRef.current.time < DOUBLE_TAP_DELAY && stickyLastTapRef.current.id === sn.id) {
            stickyLastTapRef.current = { time: 0, id: -1 };
            clearSelection();
            setEditingStickyId(sn.id);
            setEditingStickyText(sn.text);
            redrawAll();
            return;
          }
          stickyLastTapRef.current = { time: now, id: sn.id };

          // If already selected, check rotate handle first, then resize handles, then body for move
          if (selectedStickyId === sn.id) {
            const ha = 20 / zoomRef.current;
            // Check rotate handle (above top center)
            const rotHX = sn.x + sn.width / 2;
            const rotHY = sn.y - 24 / zoomRef.current;
            if (Math.abs(point.x - rotHX) < ha && Math.abs(point.y - rotHY) < ha) {
              undoStackRef.current = [...undoStackRef.current.slice(-(MAX_UNDO - 1)), cloneLayers(layersRef.current)];
              redoStackRef.current = [];
              stickyDragRef.current = {
                noteId: sn.id, startX: point.x, startY: point.y,
                origX: sn.x, origY: sn.y, type: 'rotate',
                origW: sn.width, origH: sn.height,
                origRotation: sn.rotation || 0,
              };
              redrawAll();
              return;
            }
            type StickyHandleType = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r';
            const handles: { key: StickyHandleType; cx: number; cy: number }[] = [
              { key: 'tl', cx: sn.x, cy: sn.y },
              { key: 't', cx: sn.x + sn.width / 2, cy: sn.y },
              { key: 'tr', cx: sn.x + sn.width, cy: sn.y },
              { key: 'l', cx: sn.x, cy: sn.y + sn.height / 2 },
              { key: 'r', cx: sn.x + sn.width, cy: sn.y + sn.height / 2 },
              { key: 'bl', cx: sn.x, cy: sn.y + sn.height },
              { key: 'b', cx: sn.x + sn.width / 2, cy: sn.y + sn.height },
              { key: 'br', cx: sn.x + sn.width, cy: sn.y + sn.height },
            ];
            let hitHandle: StickyHandleType | null = null;
            for (const h of handles) {
              if (Math.abs(point.x - h.cx) < ha && Math.abs(point.y - h.cy) < ha) {
                hitHandle = h.key;
                break;
              }
            }
            undoStackRef.current = [...undoStackRef.current.slice(-(MAX_UNDO - 1)), cloneLayers(layersRef.current)];
            redoStackRef.current = [];
            if (hitHandle) {
              stickyDragRef.current = {
                noteId: sn.id, startX: point.x, startY: point.y,
                origX: sn.x, origY: sn.y, type: 'resize',
                origW: sn.width, origH: sn.height, handle: hitHandle,
              };
            } else if (point.x >= sn.x && point.x <= sn.x + sn.width &&
                       point.y >= sn.y && point.y <= sn.y + sn.height) {
              stickyDragRef.current = {
                noteId: sn.id, startX: point.x, startY: point.y,
                origX: sn.x, origY: sn.y, type: 'move',
              };
            }
            redrawAll();
            return;
          }

          // Single click: select the sticky
          clearSelection();
          setSelectedStickyId(sn.id);
          redrawAll();
          return;
        }
      }

      // Hit test images (back to front)
      for (let i = (layer.images || []).length - 1; i >= 0; i--) {
        const img = layer.images[i];
        if (point.x >= img.x - 10/zoomRef.current && point.x <= img.x + img.width + 10/zoomRef.current &&
            point.y >= img.y - 10/zoomRef.current && point.y <= img.y + img.height + 10/zoomRef.current) {
          clearSelection();
          setSelectedImageId(img.id);
          const ha = 20 / zoomRef.current;
          // Detect which handle is hit (8 handles)
          type HandleType = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r';
          const handles: { key: HandleType; cx: number; cy: number }[] = [
            { key: 'tl', cx: img.x, cy: img.y },
            { key: 't', cx: img.x + img.width / 2, cy: img.y },
            { key: 'tr', cx: img.x + img.width, cy: img.y },
            { key: 'l', cx: img.x, cy: img.y + img.height / 2 },
            { key: 'r', cx: img.x + img.width, cy: img.y + img.height / 2 },
            { key: 'bl', cx: img.x, cy: img.y + img.height },
            { key: 'b', cx: img.x + img.width / 2, cy: img.y + img.height },
            { key: 'br', cx: img.x + img.width, cy: img.y + img.height },
          ];
          let hitHandle: HandleType | null = null;
          for (const h of handles) {
            if (Math.abs(point.x - h.cx) < ha && Math.abs(point.y - h.cy) < ha) {
              hitHandle = h.key;
              break;
            }
          }
          undoStackRef.current = [...undoStackRef.current.slice(-(MAX_UNDO - 1)), cloneLayers(layersRef.current)];
          redoStackRef.current = [];
          if (hitHandle) {
            imageDragRef.current = {
              imageId: img.id, startX: point.x, startY: point.y,
              origX: img.x, origY: img.y, type: 'resize',
              origW: img.width, origH: img.height, handle: hitHandle,
            };
          } else if (point.x >= img.x && point.x <= img.x + img.width &&
                     point.y >= img.y && point.y <= img.y + img.height) {
            imageDragRef.current = {
              imageId: img.id, startX: point.x, startY: point.y,
              origX: img.x, origY: img.y, type: 'move',
            };
          }
          redrawAll();
          return;
        }
      }

      // Hit test strokes (back to front)
      let hitIdx = -1;
      for (let i = layer.strokes.length - 1; i >= 0; i--) {
        if (hitTestStroke(layer.strokes[i], point.x, point.y, HIT_TOLERANCE / zoomRef.current)) {
          hitIdx = i;
          break;
        }
      }

      if (hitIdx >= 0) {
        setSelectedIndices([hitIdx]);
        setSelectionRotation(0);
      } else {
        clearSelection();
        // Start marquee selection
        marqueeRef.current = { startX: point.x, startY: point.y, currentX: point.x, currentY: point.y };
      }
      redrawAll();
      return;
    }

    // --- Drawing tools ---
    const layer = layersRef.current.find(l => l.id === activeLayerId);
    if (!layer?.visible) return;

    // Clear selection when switching to drawing
    if (selectedIndices.length > 0) clearSelection();

    canvas.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    currentPressureRef.current = e.pressure > 0 ? e.pressure : 0.5;
    setPressureValue(currentPressureRef.current);
    setShowPressure(true);

    const point = getPos(e);
    lastPointRef.current = point;

    let strokeColor = color;
    if (toolOpacity < 1) strokeColor = hexToRgba(color, toolOpacity);

    const startPoint = snapEnabled && isShapeTool(tool)
      ? { ...point, x: snapToGrid(point.x, GRID_SIZES[background]), y: snapToGrid(point.y, GRID_SIZES[background]) }
      : point;

    currentStrokeRef.current = {
      points: [startPoint],
      color: strokeColor,
      width: strokeWidth,
      tool,
      ...(isShapeTool(tool) && fillEnabled ? { fillColor, fillOpacity } : {}),
    };
  }, [color, strokeWidth, tool, activeLayerId, redrawAll, eyedropperActive, applyColor, toolOpacity, selectedIndices, selectionRotation, clearSelection, fillEnabled, fillColor, fillOpacity, snapEnabled, background]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (e.pointerType === 'touch' && activeTouchesRef.current.has(e.pointerId)) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      activeTouchesRef.current.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });

      const gesture = gestureStateRef.current;
      if (gesture?.isPinching && activeTouchesRef.current.size >= 2) {
        const touches = Array.from(activeTouchesRef.current.values());
        const dx = touches[1].x - touches[0].x; const dy = touches[1].y - touches[0].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const midX = (touches[0].x + touches[1].x) / 2; const midY = (touches[0].y + touches[1].y) / 2;
        const scale = dist / gesture.initialDist;
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, gesture.initialZoom * scale));
        const panDx = midX - gesture.initialMid.x; const panDy = midY - gesture.initialMid.y;
        zoomRef.current = newZoom;
        panRef.current = { x: gesture.initialPan.x + panDx, y: gesture.initialPan.y + panDy };
        setZoomDisplay(Math.round(newZoom * 100));
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(redrawAll);
        return;
      }
    }

    // Sticky note drag/resize (works in both sticky and select tool)
    if (stickyDragRef.current) {
      const point = getPos(e);
      const drag = stickyDragRef.current;
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      const layer = layersRef.current.find(l => l.id === activeLayerId);
      if (!layer) return;
      const sn = (layer.stickyNotes || []).find(s => s.id === drag.noteId);
      if (!sn) return;
      if (drag.type === 'move') {
        sn.x = drag.origX + dx;
        sn.y = drag.origY + dy;
      } else if (drag.type === 'rotate') {
        // Calculate angle from center of sticky to pointer
        const cx = sn.x + sn.width / 2;
        const cy = sn.y + sn.height / 2;
        const startAngle = Math.atan2(drag.startY - cy, drag.startX - cx);
        const currentAngle = Math.atan2(point.y - cy, point.x - cx);
        sn.rotation = (drag.origRotation || 0) + (currentAngle - startAngle);
      } else {
        const oW = drag.origW || 150;
        const oH = drag.origH || 150;
        const oX = drag.origX;
        const oY = drag.origY;
        const h = drag.handle || 'br';
        let newX = oX, newY = oY, newW = oW, newH = oH;
        if (h === 'br') { newW = oW + dx; newH = oH + dy; }
        else if (h === 'bl') { newX = oX + dx; newW = oW - dx; newH = oH + dy; }
        else if (h === 'tr') { newY = oY + dy; newW = oW + dx; newH = oH - dy; }
        else if (h === 'tl') { newX = oX + dx; newY = oY + dy; newW = oW - dx; newH = oH - dy; }
        else if (h === 't') { newY = oY + dy; newH = oH - dy; }
        else if (h === 'b') { newH = oH + dy; }
        else if (h === 'l') { newX = oX + dx; newW = oW - dx; }
        else if (h === 'r') { newW = oW + dx; }
        if (newW < 60) { newW = 60; if (h === 'tl' || h === 'bl' || h === 'l') newX = oX + oW - 60; }
        if (newH < 60) { newH = 60; if (h === 'tl' || h === 'tr' || h === 't') newY = oY + oH - 60; }
        sn.x = newX; sn.y = newY; sn.width = newW; sn.height = newH;
      }
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(redrawAll);
      return;
    }

    // Image drag/resize
    if (imageDragRef.current) {
      const point = getPos(e);
      const drag = imageDragRef.current;
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      const layer = layersRef.current.find(l => l.id === activeLayerId);
      if (!layer) return;
      const img = (layer.images || []).find(im => im.id === drag.imageId);
      if (!img) return;
      if (drag.type === 'move') {
        img.x = drag.origX + dx;
        img.y = drag.origY + dy;
      } else {
        const oW = drag.origW || 100;
        const oH = drag.origH || 100;
        const oX = drag.origX;
        const oY = drag.origY;
        const h = drag.handle || 'br';
        let newX = oX, newY = oY, newW = oW, newH = oH;
        if (h === 'br') { newW = oW + dx; newH = oH + dy; }
        else if (h === 'bl') { newX = oX + dx; newW = oW - dx; newH = oH + dy; }
        else if (h === 'tr') { newY = oY + dy; newW = oW + dx; newH = oH - dy; }
        else if (h === 'tl') { newX = oX + dx; newY = oY + dy; newW = oW - dx; newH = oH - dy; }
        else if (h === 't') { newY = oY + dy; newH = oH - dy; }
        else if (h === 'b') { newH = oH + dy; }
        else if (h === 'l') { newX = oX + dx; newW = oW - dx; }
        else if (h === 'r') { newW = oW + dx; }
        if (newW < 20) { newW = 20; if (h === 'tl' || h === 'bl' || h === 'l') newX = oX + oW - 20; }
        if (newH < 20) { newH = 20; if (h === 'tl' || h === 'tr' || h === 't') newY = oY + oH - 20; }
        img.x = newX; img.y = newY; img.width = newW; img.height = newH;
      }
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(redrawAll);
      return;
    }

    // Selection dragging
    if (tool === 'select' && selectionActionRef.current) {
      const point = getPos(e);
      const action = selectionActionRef.current;
      const layer = layersRef.current.find(l => l.id === activeLayerId);
      if (!layer) return;

      const dx = point.x - action.startPos.x;
      const dy = point.y - action.startPos.y;

      if (action.type === 'body') {
        // Move
        const transformed = action.origStrokes.map(s => ({
          ...s,
          points: s.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })),
        }));
        for (let i = 0; i < selectedIndices.length; i++) {
          if (selectedIndices[i] < layer.strokes.length) {
            layer.strokes[selectedIndices[i]] = transformed[i];
          }
        }
      } else if (action.type === 'rotate') {
        const cx = action.origBBox.x + action.origBBox.w / 2;
        const cy = action.origBBox.y + action.origBBox.h / 2;
        const startAngle = Math.atan2(action.startPos.y - cy, action.startPos.x - cx);
        const currAngle = Math.atan2(point.y - cy, point.x - cx);
        const rotation = currAngle - startAngle;
        setSelectionRotation(action.origRotation + rotation);

        const transformed = transformStrokes(action.origStrokes, action.origBBox, action.origBBox, rotation);
        for (let i = 0; i < selectedIndices.length; i++) {
          if (selectedIndices[i] < layer.strokes.length) {
            layer.strokes[selectedIndices[i]] = transformed[i];
          }
        }
      } else {
        // Resize
        const ob = action.origBBox;
        let newX = ob.x, newY = ob.y, newW = ob.w, newH = ob.h;

        switch (action.type) {
          case 'br': newW = Math.max(10, ob.w + dx); newH = Math.max(10, ob.h + dy); break;
          case 'bl': newX = ob.x + dx; newW = Math.max(10, ob.w - dx); newH = Math.max(10, ob.h + dy); break;
          case 'tr': newW = Math.max(10, ob.w + dx); newY = ob.y + dy; newH = Math.max(10, ob.h - dy); break;
          case 'tl': newX = ob.x + dx; newY = ob.y + dy; newW = Math.max(10, ob.w - dx); newH = Math.max(10, ob.h - dy); break;
        }

        const newBBox: BBox = { x: newX, y: newY, w: newW, h: newH };
        const transformed = transformStrokes(action.origStrokes, ob, newBBox, 0);
        for (let i = 0; i < selectedIndices.length; i++) {
          if (selectedIndices[i] < layer.strokes.length) {
            layer.strokes[selectedIndices[i]] = transformed[i];
          }
        }
      }

      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(redrawAll);
      return;
    }

    // Marquee drag
    if (tool === 'select' && marqueeRef.current) {
      const point = getPos(e);
      marqueeRef.current.currentX = point.x;
      marqueeRef.current.currentY = point.y;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(redrawAll);
      return;
    }

    if (!isDrawingRef.current || !currentStrokeRef.current) return;
    if (isPalmTouch(e)) return;

    const point = getPos(e);
    currentPressureRef.current = e.pressure > 0 ? e.pressure : 0.5;
    setPressureValue(currentPressureRef.current);

    if (isShapeTool(currentStrokeRef.current.tool)) {
      const snapped = snapEnabled
        ? { ...point, x: snapToGrid(point.x, GRID_SIZES[background]), y: snapToGrid(point.y, GRID_SIZES[background]) }
        : point;
      currentStrokeRef.current.points = [currentStrokeRef.current.points[0], snapped];
    } else {
      const last = lastPointRef.current;
      if (last) {
        const dx = point.x - last.x; const dy = point.y - last.y;
        if (dx * dx + dy * dy < MIN_POINT_DISTANCE * MIN_POINT_DISTANCE) return;
        // Apply exponential moving average smoothing for silky lines
        point.x = last.x + (point.x - last.x) * (1 - SMOOTHING_FACTOR);
        point.y = last.y + (point.y - last.y) * (1 - SMOOTHING_FACTOR);
        // Smooth pressure too to avoid sudden width jumps
        point.pressure = last.pressure * SMOOTHING_FACTOR + point.pressure * (1 - SMOOTHING_FACTOR);
      }
      lastPointRef.current = point;
      currentStrokeRef.current.points.push(point);
    }

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(redrawAll);
  }, [redrawAll, tool, selectedIndices, activeLayerId, snapEnabled, background]);

  const emitChange = useCallback(() => {
    const data: SketchData = {
      layers: layersRef.current,
      activeLayerId,
      background,
      width: canvasSizeRef.current.w,
      height: canvasSizeRef.current.h,
      version: 2,
    };
    onChange(JSON.stringify(data));
  }, [onChange, activeLayerId, background]);

  // Keep refs in sync
  emitChangeRef.current = emitChange;

  const onPointerUp = useCallback((e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      activeTouchesRef.current.delete(e.pointerId);
      if (activeTouchesRef.current.size < 2) gestureStateRef.current = null;
    }

    // Finish sticky note drag (works in both sticky and select tool)
    if (stickyDragRef.current) {
      stickyDragRef.current = null;
      forceUpdate(n => n + 1);
      redrawAll();
      emitChange();
      return;
    }
    // Finish image drag
    if (imageDragRef.current) {
      imageDragRef.current = null;
      forceUpdate(n => n + 1);
      redrawAll();
      emitChange();
      return;
    }

    // Clear image selection if clicking empty space in select mode
    if (tool === 'select' && selectedImageId != null && !imageDragRef.current) {
      const point = getPos(e);
      const layer = layersRef.current.find(l => l.id === activeLayerId);
      if (layer) {
        const hitImg = (layer.images || []).some(img =>
          point.x >= img.x && point.x <= img.x + img.width &&
          point.y >= img.y && point.y <= img.y + img.height
        );
        if (!hitImg) setSelectedImageId(null);
      }
    }

    // Finish marquee selection
    if (tool === 'select' && marqueeRef.current) {
      const m = marqueeRef.current;
      const mx = Math.min(m.startX, m.currentX);
      const my = Math.min(m.startY, m.currentY);
      const mw = Math.abs(m.currentX - m.startX);
      const mh = Math.abs(m.currentY - m.startY);
      marqueeRef.current = null;

      if (mw > 5 || mh > 5) {
        const layer = layersRef.current.find(l => l.id === activeLayerId);
        if (layer) {
          const hits: number[] = [];
          for (let i = 0; i < layer.strokes.length; i++) {
            if (layer.strokes[i].tool === 'eraser') continue;
            const sb = getStrokeBBox(layer.strokes[i]);
            // Check if stroke bbox intersects marquee
            if (sb.x + sb.w >= mx && sb.x <= mx + mw && sb.y + sb.h >= my && sb.y <= my + mh) {
              hits.push(i);
            }
          }
          if (hits.length > 0) {
            setSelectedIndices(hits);
            setSelectionRotation(0);
          }
        }
      }
      redrawAll();
      return;
    }

    // Finish selection action
    if (tool === 'select' && selectionActionRef.current) {
      selectionActionRef.current = null;
      forceUpdate(n => n + 1);
      redrawAll();
      emitChange();
      return;
    }

    if (!isDrawingRef.current || !currentStrokeRef.current) return;
    isDrawingRef.current = false;
    lastPointRef.current = null;
    setShowPressure(false);

    const finishedStroke = currentStrokeRef.current;
    const minPoints = finishedStroke.tool === 'spray' ? 1 : 2;
    if (finishedStroke.points.length >= minPoints) {
      undoStackRef.current = [
        ...undoStackRef.current.slice(-(MAX_UNDO - 1)),
        cloneLayers(layersRef.current),
      ];
      redoStackRef.current = [];
      const layer = layersRef.current.find(l => l.id === activeLayerId);
      if (layer) {
        layer.strokes = [...layer.strokes, finishedStroke];
        // Auto-select shapes after drawing
        if (isShapeTool(finishedStroke.tool)) {
          const newIdx = layer.strokes.length - 1;
          setSelectedIndices([newIdx]);
          setSelectionRotation(0);
          setTool('select');
        }
      }
    }
    currentStrokeRef.current = null;
    redrawAll();
    emitChange();
  }, [redrawAll, emitChange, activeLayerId, tool]);

  // --- Wheel zoom ---

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top;
    const zoomFactor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    const oldZoom = zoomRef.current;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * zoomFactor));
    const pan = panRef.current;
    panRef.current = {
      x: mouseX - (mouseX - pan.x) * (newZoom / oldZoom),
      y: mouseY - (mouseY - pan.y) * (newZoom / oldZoom),
    };
    zoomRef.current = newZoom;
    setZoomDisplay(Math.round(newZoom * 100));
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(redrawAll);
  }, [redrawAll]);

  const handleResetZoom = useCallback(() => {
    zoomRef.current = 1; panRef.current = { x: 0, y: 0 }; setZoomDisplay(100); redrawAll();
  }, [redrawAll]);

  // --- Actions ---

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    redoStackRef.current.push(cloneLayers(layersRef.current));
    layersRef.current = undoStackRef.current.pop()!;
    clearSelection();
    forceUpdate(n => n + 1);
    redrawAll();
    emitChange();
  }, [redrawAll, emitChange, clearSelection]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    undoStackRef.current.push(cloneLayers(layersRef.current));
    layersRef.current = redoStackRef.current.pop()!;
    clearSelection();
    forceUpdate(n => n + 1);
    redrawAll();
    emitChange();
  }, [redrawAll, emitChange, clearSelection]);

  const handleClear = useCallback(() => {
    undoStackRef.current.push(cloneLayers(layersRef.current));
    redoStackRef.current = [];
    const layer = layersRef.current.find(l => l.id === activeLayerId);
    if (layer) { layer.strokes = []; layer.textAnnotations = []; layer.stickyNotes = []; layer.images = []; }
    clearSelection();
    forceUpdate(n => n + 1);
    redrawAll();
    emitChange();
  }, [redrawAll, emitChange, activeLayerId, clearSelection]);

  const handleExportPng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onImageExport) return;
    onImageExport(canvas.toDataURL('image/png'));
  }, [onImageExport]);

  const handleExportSvg = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    const svg = generateSvg(layersRef.current, w, h, background);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'sketch.svg'; a.click();
    URL.revokeObjectURL(url);
  }, [background]);

  const handleExportPdf = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = canvasSizeRef.current;
    const orientation = w >= h ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'px', format: [w, h] });
    const imgData = canvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 0, 0, w, h);
    pdf.save('sketch.pdf');
  }, []);

  const handleDownloadPng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url; a.download = 'sketch.png'; a.click();
  }, []);

  const handleNativeShare = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      await Share.share({
        title: 'Sketch',
        text: 'Check out my sketch!',
        url: dataUrl,
        dialogTitle: 'Share Sketch',
      });
    } catch {
      // Fallback: try Web Share API with blob
      try {
        const blob = await new Promise<Blob>((resolve) =>
          canvas.toBlob((b) => resolve(b!), 'image/png')
        );
        const file = new File([blob], 'sketch.png', { type: 'image/png' });
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ title: 'Sketch', files: [file] });
        } else {
          handleDownloadPng();
        }
      } catch {
        handleDownloadPng();
      }
    }
  }, [handleDownloadPng]);

  // --- Palette manager ---
  const savePalettes = useCallback((palettes: { name: string; colors: string[] }[]) => {
    setSavedPalettes(palettes);
    try { localStorage.setItem('sketch-color-palettes', JSON.stringify(palettes)); } catch {}
  }, []);

  const addCurrentColorToPalette = useCallback(() => {
    const updated = [...savedPalettes];
    const palette = updated[activePaletteIdx];
    if (palette && !palette.colors.includes(color)) {
      palette.colors = [...palette.colors, color];
      savePalettes(updated);
    }
  }, [savedPalettes, activePaletteIdx, color, savePalettes]);

  const removeColorFromPalette = useCallback((colorToRemove: string) => {
    const updated = [...savedPalettes];
    const palette = updated[activePaletteIdx];
    if (palette) {
      palette.colors = palette.colors.filter(c => c !== colorToRemove);
      savePalettes(updated);
    }
  }, [savedPalettes, activePaletteIdx, savePalettes]);

  const createNewPalette = useCallback((name: string) => {
    if (!name.trim()) return;
    const updated = [...savedPalettes, { name: name.trim(), colors: [color] }];
    savePalettes(updated);
    setActivePaletteIdx(updated.length - 1);
    setNewPaletteName('');
  }, [savedPalettes, color, savePalettes]);

  const deletePalette = useCallback((idx: number) => {
    if (savedPalettes.length <= 1) return;
    const updated = savedPalettes.filter((_, i) => i !== idx);
    savePalettes(updated);
    setActivePaletteIdx(Math.min(activePaletteIdx, updated.length - 1));
  }, [savedPalettes, activePaletteIdx, savePalettes]);

  // --- SVG Import ---
  const handleSvgImport = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const svgText = ev.target?.result as string;
      // Create an image from SVG
      const blob = new Blob([svgText], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = new window.Image();
      img.onload = () => {
        const dataUrl = (() => {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || 300;
          c.height = img.naturalHeight || 300;
          const cx = c.getContext('2d');
          if (cx) cx.drawImage(img, 0, 0);
          return c.toDataURL('image/png');
        })();
        URL.revokeObjectURL(url);
        imageCacheRef.current.set(dataUrl, img);
        const layer = layersRef.current.find(l => l.id === activeLayerId);
        if (!layer) return;
        undoStackRef.current = [...undoStackRef.current.slice(-(MAX_UNDO - 1)), cloneLayers(layersRef.current)];
        redoStackRef.current = [];
        if (!layer.images) layer.images = [];
        const maxDim = 300;
        const nw = img.naturalWidth || 300;
        const nh = img.naturalHeight || 300;
        const scale = Math.min(1, maxDim / Math.max(nw, nh));
        const w = nw * scale;
        const h = nh * scale;
        const zoom = zoomRef.current;
        const pan = panRef.current;
        const cw = canvasSizeRef.current.w;
        const ch = canvasSizeRef.current.h;
        const cx = (cw / 2 - pan.x) / zoom;
        const cy = (ch / 2 - pan.y) / zoom;
        const newImg: CanvasImageData = {
          id: nextImageIdRef.current++,
          x: cx - w / 2, y: cy - h / 2,
          width: w, height: h,
          src: dataUrl,
          naturalWidth: nw, naturalHeight: nh,
        };
        layer.images.push(newImg);
        setSelectedImageId(newImg.id);
        setTool('select');
        forceUpdate(n => n + 1);
        redrawRef.current();
        emitChangeRef.current();
      };
      img.src = url;
    };
    reader.readAsText(file);
  }, [activeLayerId]);

  // --- Timelapse Replay ---
  const handleTimelapseReplay = useCallback(async () => {
    if (isPlayingTimelapse) {
      timelapseAbortRef.current = true;
      return;
    }
    // Gather all strokes across all layers in order
    const allStrokes: { layerId: number; stroke: Stroke }[] = [];
    for (const layer of layersRef.current) {
      for (const stroke of layer.strokes) {
        allStrokes.push({ layerId: layer.id, stroke });
      }
    }
    if (allStrokes.length === 0) return;

    // Save current state
    const savedLayers = cloneLayers(layersRef.current);
    
    // Clear all strokes
    for (const layer of layersRef.current) {
      layer.strokes = [];
    }
    redrawAll();

    setIsPlayingTimelapse(true);
    timelapseAbortRef.current = false;

    // Replay stroke by stroke
    for (let i = 0; i < allStrokes.length; i++) {
      if (timelapseAbortRef.current) break;
      const { layerId, stroke } = allStrokes[i];
      const layer = layersRef.current.find(l => l.id === layerId);
      if (layer) {
        layer.strokes.push(stroke);
        redrawAll();
      }
      // Delay proportional to stroke complexity
      const delay = Math.min(200, Math.max(30, stroke.points.length * 2));
      await new Promise(r => setTimeout(r, delay));
    }

    // Restore if aborted early
    if (timelapseAbortRef.current) {
      layersRef.current.splice(0, layersRef.current.length, ...savedLayers);
      redrawAll();
    }
    setIsPlayingTimelapse(false);
  }, [isPlayingTimelapse, redrawAll]);

  // --- Selection actions ---

  const handleCopySelection = useCallback(() => {
    clipboardRef.current = cloneStrokes(getSelectedStrokes());
  }, [getSelectedStrokes]);

  const handlePasteSelection = useCallback(() => {
    if (clipboardRef.current.length === 0) return;
    const layer = layersRef.current.find(l => l.id === activeLayerId);
    if (!layer) return;

    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_UNDO - 1)),
      cloneLayers(layersRef.current),
    ];
    redoStackRef.current = [];

    // Offset pasted strokes slightly
    const pasted = cloneStrokes(clipboardRef.current).map(s => ({
      ...s,
      points: s.points.map(p => ({ ...p, x: p.x + 20, y: p.y + 20 })),
    }));
    const startIdx = layer.strokes.length;
    layer.strokes = [...layer.strokes, ...pasted];
    setSelectedIndices(pasted.map((_, i) => startIdx + i));
    setSelectionRotation(0);
    forceUpdate(n => n + 1);
    redrawAll();
    emitChange();
  }, [activeLayerId, redrawAll, emitChange]);

  const handleDeleteSelection = useCallback(() => {
    if (selectedIndices.length === 0) return;
    const layer = layersRef.current.find(l => l.id === activeLayerId);
    if (!layer) return;

    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_UNDO - 1)),
      cloneLayers(layersRef.current),
    ];
    redoStackRef.current = [];

    const toDelete = new Set(selectedIndices);
    layer.strokes = layer.strokes.filter((_, i) => !toDelete.has(i));
    clearSelection();
    forceUpdate(n => n + 1);
    redrawAll();
    emitChange();
  }, [selectedIndices, activeLayerId, redrawAll, emitChange, clearSelection]);

  // --- Layer controls ---

  const setLayerOpacity = useCallback((layerId: number, opacity: number) => {
    const layer = layersRef.current.find(l => l.id === layerId);
    if (layer) { layer.opacity = opacity; forceUpdate(n => n + 1); redrawAll(); emitChange(); }
  }, [redrawAll, emitChange]);

  const toggleLayerVisibility = useCallback((layerId: number) => {
    const layer = layersRef.current.find(l => l.id === layerId);
    if (layer) { layer.visible = !layer.visible; forceUpdate(n => n + 1); redrawAll(); emitChange(); }
  }, [redrawAll, emitChange]);

  const handleBackgroundChange = useCallback((bg: BackgroundType) => { setBackground(bg); }, []);

  useEffect(() => { redrawAll(); emitChange(); }, [background]);

  // --- Init ---

  useEffect(() => {
    if (initialData) {
      try {
        const data = JSON.parse(initialData);
        if (data.version === 2 && data.layers) {
          layersRef.current = data.layers.map((l: any) => ({ ...l, textAnnotations: l.textAnnotations || [], stickyNotes: l.stickyNotes || [], images: l.images || [] }));
          // Track max text id, sticky id, image id
          for (const l of layersRef.current) {
            for (const ta of l.textAnnotations) {
              if (ta.id >= nextTextIdRef.current) nextTextIdRef.current = ta.id + 1;
            }
            for (const sn of (l.stickyNotes || [])) {
              if (sn.id >= nextStickyIdRef.current) nextStickyIdRef.current = sn.id + 1;
            }
            for (const img of (l.images || [])) {
              if (img.id >= nextImageIdRef.current) nextImageIdRef.current = img.id + 1;
            }
          }
          setActiveLayerId(data.activeLayerId ?? 1);
          if (data.background) setBackground(data.background);
        } else if (data.strokes) {
          const layers = createDefaultLayers();
          layers[0].strokes = data.strokes;
          layersRef.current = layers;
        }
      } catch { /* ignore */ }
    }
    resizeCanvas();
    const handleResize = () => resizeCanvas();
    window.addEventListener('resize', handleResize);
    return () => { window.removeEventListener('resize', handleResize); cancelAnimationFrame(rafRef.current); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [onPointerDown, onPointerMove, onPointerUp, onWheel]);

  // Clear selection when switching away from select tool
  useEffect(() => {
    if (tool !== 'select') clearSelection();
    if (tool !== 'sticky') setSelectedStickyId(null);
  }, [tool, clearSelection]);

  // Focus text input when editing
  useEffect(() => {
    if (editingText && textInputRef.current) {
      setTimeout(() => textInputRef.current?.focus(), 50);
    }
  }, [editingText]);

  const commitTextAnnotation = useCallback(() => {
    if (!editingText || !editingTextValue.trim()) {
      setEditingText(null);
      setEditingTextValue('');
      return;
    }
    const layer = layersRef.current.find(l => l.id === activeLayerId);
    if (!layer) { setEditingText(null); return; }

    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_UNDO - 1)),
      cloneLayers(layersRef.current),
    ];
    redoStackRef.current = [];

    if (!layer.textAnnotations) layer.textAnnotations = [];

    if (editingText.annotationId != null) {
      // Update existing
      const idx = layer.textAnnotations.findIndex(ta => ta.id === editingText.annotationId);
      if (idx >= 0) {
        layer.textAnnotations[idx] = {
          ...layer.textAnnotations[idx],
          text: editingTextValue,
          font: textFont,
          fontSize: textFontSize,
          color,
          bold: textBold,
          italic: textItalic,
        };
      }
    } else {
      // Create new
      layer.textAnnotations.push({
        id: nextTextIdRef.current++,
        x: editingText.x,
        y: editingText.y,
        text: editingTextValue,
        font: textFont,
        fontSize: textFontSize,
        color,
        bold: textBold,
        italic: textItalic,
      });
    }

    setEditingText(null);
    setEditingTextValue('');
    forceUpdate(n => n + 1);
    redrawAll();
    emitChange();
  }, [editingText, editingTextValue, activeLayerId, color, textFont, textFontSize, textBold, textItalic, redrawAll, emitChange]);

  const commitStickyNote = useCallback(() => {
    if (editingStickyId == null) return;
    const layer = layersRef.current.find(l => l.id === activeLayerId);
    if (layer) {
      const sn = (layer.stickyNotes || []).find(s => s.id === editingStickyId);
      if (sn) {
        sn.text = editingStickyText;
      }
    }
    setEditingStickyId(null);
    setEditingStickyText('');
    forceUpdate(n => n + 1);
    redrawAll();
    emitChange();
  }, [editingStickyId, editingStickyText, activeLayerId, redrawAll, emitChange]);

  const handleDeleteStickyNote = useCallback((noteId: number) => {
    const layer = layersRef.current.find(l => l.id === activeLayerId);
    if (!layer) return;
    undoStackRef.current = [...undoStackRef.current.slice(-(MAX_UNDO - 1)), cloneLayers(layersRef.current)];
    redoStackRef.current = [];
    layer.stickyNotes = (layer.stickyNotes || []).filter(sn => sn.id !== noteId);
    setEditingStickyId(null);
    forceUpdate(n => n + 1);
    redrawAll();
    emitChange();
  }, [activeLayerId, redrawAll, emitChange]);

  // Double-tap sticky to edit
  const handleStickyDoubleTap = useCallback((noteId: number) => {
    const layer = layersRef.current.find(l => l.id === activeLayerId);
    if (!layer) return;
    const sn = (layer.stickyNotes || []).find(s => s.id === noteId);
    if (sn) {
      setEditingStickyId(noteId);
      setEditingStickyText(sn.text);
    }
  }, [activeLayerId]);

  // Focus sticky input
  useEffect(() => {
    if (editingStickyId != null && stickyInputRef.current) {
      setTimeout(() => stickyInputRef.current?.focus(), 50);
    }
  }, [editingStickyId]);

  const activeDrawTool = DRAW_TOOLS.find(d => d.id === tool);
  const activeShapeTool = SHAPE_TOOLS.find(s => s.id === tool);
  const layers = layersRef.current;
  const hasSelection = selectedIndices.length > 0;

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div ref={containerRef} className={cn(
        'flex-1 min-h-0 relative overflow-hidden touch-none',
        background === 'dark' ? 'bg-[#1a1a2e]' : 'bg-background'
      )}>
        <canvas
          ref={canvasRef}
          className={cn(
            'absolute inset-0',
            eyedropperActive ? 'cursor-cell' :
            tool === 'text' ? 'cursor-text' :
            tool === 'sticky' ? 'cursor-crosshair' :
            tool === 'select' ? 'cursor-default' : 'cursor-crosshair'
          )}
          style={{ touchAction: 'none' }}
        />
        {/* Ruler overlays - re-render on zoom/pan changes */}
        {showRulers && zoomDisplay >= 0 && (
          <>
            {/* Top horizontal ruler */}
            <canvas
              ref={(el) => {
                if (!el) return;
                const ctx = el.getContext('2d');
                if (!ctx) return;
                const dpr = window.devicePixelRatio || 1;
                const rect = el.parentElement?.getBoundingClientRect();
                if (!rect) return;
                const w = rect.width;
                el.width = w * dpr;
                el.height = 24 * dpr;
                el.style.width = w + 'px';
                el.style.height = '24px';
                ctx.scale(dpr, dpr);
                ctx.fillStyle = 'hsl(var(--card))';
                ctx.fillRect(0, 0, w, 24);
                ctx.strokeStyle = 'hsl(var(--border))';
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(0, 23.5); ctx.lineTo(w, 23.5); ctx.stroke();
                const zoom = zoomRef.current;
                const panX = panRef.current.x;
                const step = zoom >= 2 ? 10 : zoom >= 0.5 ? 25 : 50;
                const majorStep = step * 4;
                ctx.font = '9px system-ui';
                ctx.fillStyle = 'hsl(var(--muted-foreground))';
                ctx.textAlign = 'center';
                const startWorld = Math.floor(-panX / zoom / step) * step - step;
                const endWorld = Math.ceil((-panX + w) / zoom / step) * step + step;
                for (let worldX = startWorld; worldX <= endWorld; worldX += step) {
                  const screenX = worldX * zoom + panX;
                  if (screenX < 24 || screenX > w) continue;
                  const isMajor = worldX % majorStep === 0;
                  ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.4)';
                  ctx.lineWidth = isMajor ? 1 : 0.5;
                  ctx.beginPath();
                  ctx.moveTo(screenX, isMajor ? 6 : 14);
                  ctx.lineTo(screenX, 23);
                  ctx.stroke();
                  if (isMajor) ctx.fillText(String(worldX), screenX, 11);
                }
                // Corner square
                ctx.fillStyle = 'hsl(var(--card))';
                ctx.fillRect(0, 0, 24, 24);
                ctx.strokeStyle = 'hsl(var(--border))';
                ctx.strokeRect(0, 0, 24, 24);
                ctx.font = '7px system-ui';
                ctx.fillStyle = 'hsl(var(--muted-foreground))';
                ctx.textAlign = 'center';
                ctx.fillText('px', 12, 15);
              }}
              key={`ruler-h-${zoomDisplay}`}
              className="absolute top-0 left-0 z-20 pointer-events-none"
            />
            {/* Left vertical ruler */}
            <canvas
              ref={(el) => {
                if (!el) return;
                const ctx = el.getContext('2d');
                if (!ctx) return;
                const dpr = window.devicePixelRatio || 1;
                const rect = el.parentElement?.getBoundingClientRect();
                if (!rect) return;
                const h = rect.height;
                el.width = 24 * dpr;
                el.height = h * dpr;
                el.style.width = '24px';
                el.style.height = h + 'px';
                ctx.scale(dpr, dpr);
                ctx.fillStyle = 'hsl(var(--card))';
                ctx.fillRect(0, 0, 24, h);
                ctx.strokeStyle = 'hsl(var(--border))';
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(23.5, 0); ctx.lineTo(23.5, h); ctx.stroke();
                const zoom = zoomRef.current;
                const panY = panRef.current.y;
                const step = zoom >= 2 ? 10 : zoom >= 0.5 ? 25 : 50;
                const majorStep = step * 4;
                ctx.font = '9px system-ui';
                ctx.fillStyle = 'hsl(var(--muted-foreground))';
                ctx.textAlign = 'center';
                const startWorld = Math.floor(-panY / zoom / step) * step - step;
                const endWorld = Math.ceil((-panY + h) / zoom / step) * step + step;
                for (let worldY = startWorld; worldY <= endWorld; worldY += step) {
                  const screenY = worldY * zoom + panY;
                  if (screenY < 24 || screenY > h) continue;
                  const isMajor = worldY % majorStep === 0;
                  ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.4)';
                  ctx.lineWidth = isMajor ? 1 : 0.5;
                  ctx.beginPath();
                  ctx.moveTo(isMajor ? 6 : 14, screenY);
                  ctx.lineTo(23, screenY);
                  ctx.stroke();
                  if (isMajor) {
                    ctx.save();
                    ctx.translate(11, screenY);
                    ctx.rotate(-Math.PI / 2);
                    ctx.fillText(String(worldY), 0, 4);
                    ctx.restore();
                  }
                }
              }}
              key={`ruler-v-${zoomDisplay}`}
              className="absolute top-0 left-0 z-20 pointer-events-none"
            />
          </>
        )}
        {/* Minimap navigator */}
        <MiniMap
          layersRef={layersRef}
          zoomRef={zoomRef}
          panRef={panRef}
          canvasSizeRef={canvasSizeRef}
          zoomDisplay={zoomDisplay}
          onPanChange={(newPan) => {
            panRef.current = newPan;
            setZoomDisplay(Math.round(zoomRef.current * 100));
            redrawAll();
          }}
          onResetZoom={handleResetZoom}
        />
        {/* Eyedropper mode indicator */}
        {eyedropperActive && (
          <div className="absolute top-2 left-2 bg-primary text-primary-foreground rounded-lg px-2 py-1 text-[10px] flex items-center gap-1">
            <Pipette className="h-3 w-3" />Tap to pick color
          </div>
        )}
        {/* Pressure sensitivity indicator */}
        {showPressure && !isShapeTool(tool) && tool !== 'eraser' && tool !== 'select' && tool !== 'text' && tool !== 'sticky' && tool !== 'image' && (
          <div className="absolute top-2 right-14 bg-card/90 backdrop-blur-sm border border-border/50 rounded-xl px-2.5 py-1.5 flex items-center gap-2 pointer-events-none transition-opacity duration-200" style={{ opacity: showPressure ? 1 : 0 }}>
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[8px] text-muted-foreground font-medium uppercase tracking-wider">Pressure</span>
              <span className="text-xs font-bold text-foreground tabular-nums">{Math.round(pressureValue * 100)}%</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full rounded-full transition-all duration-75"
                  style={{ 
                    width: `${Math.round(pressureValue * 100)}%`,
                    backgroundColor: pressureValue < 0.3 ? 'hsl(var(--muted-foreground))' : pressureValue < 0.7 ? 'hsl(var(--primary))' : 'hsl(var(--destructive))',
                  }} 
                />
              </div>
              <div className="flex justify-between w-16">
                <span className="text-[6px] text-muted-foreground">Light</span>
                <span className="text-[6px] text-muted-foreground">Heavy</span>
              </div>
            </div>
            <div 
              className="w-3 h-3 rounded-full border border-border/50 transition-all duration-75"
              style={{ 
                backgroundColor: color,
                transform: `scale(${0.5 + pressureValue * 0.8})`,
                opacity: 0.4 + pressureValue * 0.6,
              }}
            />
          </div>
        )}
        {/* Selection floating actions */}
        {hasSelection && tool === 'select' && (
          <div className="absolute top-2 left-2 bg-card/95 backdrop-blur-sm border border-border rounded-lg px-1 py-1 flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopySelection} title="Copy">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handlePasteSelection} title="Paste">
              <Clipboard className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={handleDeleteSelection} title="Delete">
              <Trash className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        {/* Selected sticky note floating actions */}
        {selectedStickyId != null && (
          <div className="absolute top-2 left-2 bg-card/95 backdrop-blur-sm border border-border rounded-lg px-1 py-1 flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                handleStickyDoubleTap(selectedStickyId);
                setSelectedStickyId(null);
              }}
              title="Edit sticky note"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              onClick={() => {
                handleDeleteStickyNote(selectedStickyId);
                setSelectedStickyId(null);
              }}
              title="Delete sticky note"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        {/* Inline text input overlay */}
        {editingText && (
          <div
            className="absolute z-50"
            style={{
              left: editingText.x * zoomRef.current + panRef.current.x,
              top: editingText.y * zoomRef.current + panRef.current.y,
            }}
          >
            <textarea
              ref={textInputRef}
              value={editingTextValue}
              onChange={(e) => setEditingTextValue(e.target.value)}
              onBlur={commitTextAnnotation}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setEditingText(null); setEditingTextValue(''); }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitTextAnnotation(); }
              }}
              className="bg-transparent border border-primary/50 rounded px-1 py-0 outline-none resize-none min-w-[80px] min-h-[1.5em]"
              style={{
                font: `${textItalic ? 'italic ' : ''}${textBold ? 'bold ' : ''}${textFontSize * zoomRef.current}px ${textFont}`,
                color,
                lineHeight: 1.2,
                caretColor: color,
              }}
              rows={1}
              placeholder="Type here..."
            />
          </div>
        )}
        {/* Sticky note editing overlay */}
        {editingStickyId != null && (() => {
          const layer = layersRef.current.find(l => l.id === activeLayerId);
          const sn = layer ? (layer.stickyNotes || []).find(s => s.id === editingStickyId) : null;
          if (!sn) return null;
          const zoom = zoomRef.current;
          const pan = panRef.current;
          return (
            <div
              className="absolute z-50"
              style={{
                left: sn.x * zoom + pan.x,
                top: sn.y * zoom + pan.y,
                width: sn.width * zoom,
                height: sn.height * zoom,
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="relative w-full h-full rounded shadow-lg" style={{ backgroundColor: sn.color }}>
                <textarea
                  ref={stickyInputRef}
                  value={editingStickyText}
                  onChange={(e) => setEditingStickyText(e.target.value)}
                  onBlur={(e) => {
                    // Don't commit if clicking within the sticky overlay (color buttons, delete)
                    const related = e.relatedTarget as HTMLElement | null;
                    if (related && e.currentTarget.closest('.absolute')?.contains(related)) return;
                    commitStickyNote();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { commitStickyNote(); }
                  }}
                  className="w-full bg-transparent border-none outline-none resize-none p-2.5 text-[#1a1a1a]"
                  style={{ fontSize: sn.fontSize * zoom, height: `calc(100% - 28px)` }}
                  placeholder="Type on sticky..."
                />
                <div className="absolute top-1 right-1 flex gap-1">
                  <button
                    className="w-6 h-6 rounded flex items-center justify-center bg-foreground/10 hover:bg-foreground/20 text-foreground/70"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); commitStickyNote(); }}
                  >
                    ✓
                  </button>
                  <button
                    className="w-6 h-6 rounded flex items-center justify-center bg-destructive/20 hover:bg-destructive/40 text-destructive"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteStickyNote(sn.id); }}
                  >
                    <Trash className="h-3 w-3" />
                  </button>
                </div>
                {/* Color picker row */}
                <div className="absolute bottom-1 left-1 right-1 flex gap-1 justify-center">
                  {STICKY_COLORS.map(c => (
                    <button
                      key={c}
                      className={cn('w-5 h-5 rounded-full border-2 transition-transform active:scale-90',
                        sn.color === c ? 'border-foreground/50 scale-110' : 'border-transparent')}
                      style={{ backgroundColor: c }}
                      onMouseDown={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        sn.color = c;
                        setStickyColor(c);
                        forceUpdate(n => n + 1);
                        redrawAll();
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Focus mode floating exit button */}
      {focusMode && (
        <button
          className="absolute bottom-4 right-4 z-30 bg-card/90 backdrop-blur-sm border border-border/50 rounded-full p-3 shadow-lg text-foreground/70 hover:text-foreground hover:bg-card transition-all duration-200 active:scale-95"
          onClick={() => setFocusMode(false)}
          title="Exit Focus Mode"
        >
          <Focus className="h-5 w-5" />
        </button>
      )}

      {/* Bottom toolbar */}
      <div
        className={cn(
          'flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 border-t bg-gradient-to-t from-card to-card/95 overflow-x-auto backdrop-blur-sm transition-all duration-300',
          focusMode && 'translate-y-full opacity-0 pointer-events-none absolute bottom-0 left-0 right-0'
        )}
        style={{ paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {/* Select tool */}
        <button
          className={cn(
            'h-10 w-10 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-200',
            tool === 'select'
              ? 'bg-primary/15 text-primary shadow-[0_2px_8px_-2px_hsl(var(--primary)/0.4),inset_0_1px_1px_hsl(var(--primary-foreground)/0.1)] scale-105'
              : 'text-foreground/70 hover:bg-muted/80 hover:text-foreground hover:shadow-[0_2px_6px_-2px_hsl(var(--foreground)/0.1)] active:scale-95'
          )}
          onClick={() => { setTool('select'); setEyedropperActive(false); }}
        >
          <MousePointer2 className="h-5 w-5" strokeWidth={tool === 'select' ? 2.5 : 1.8} />
        </button>

        {/* Text tool */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              className={cn(
                'h-10 w-10 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-200',
                tool === 'text'
                  ? 'bg-primary/15 text-primary shadow-[0_2px_8px_-2px_hsl(var(--primary)/0.4),inset_0_1px_1px_hsl(var(--primary-foreground)/0.1)] scale-105'
                  : 'text-foreground/70 hover:bg-muted/80 hover:text-foreground hover:shadow-[0_2px_6px_-2px_hsl(var(--foreground)/0.1)] active:scale-95'
              )}
              onClick={() => { setTool('text'); setEyedropperActive(false); }}
            >
              <Type className="h-5 w-5" strokeWidth={tool === 'text' ? 2.5 : 1.8} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-3 bg-card" align="start" side="top">
            <p className="text-[10px] font-medium text-foreground mb-2">Text Settings</p>
            <div className="space-y-2">
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Font</p>
                <div className="grid grid-cols-2 gap-1">
                  {TEXT_FONTS.map((f) => (
                    <button key={f.id}
                      className={cn('text-[11px] px-2 py-1.5 rounded-md border text-left truncate transition-colors',
                        textFont === f.id ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted')}
                      style={{ fontFamily: f.id }}
                      onClick={() => setTextFont(f.id)}
                    >{f.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Size: {textFontSize}px</p>
                <Slider min={10} max={72} step={2} value={[textFontSize]} onValueChange={([v]) => setTextFontSize(v)} />
              </div>
              <div className="flex gap-1">
                <Button variant={textBold ? 'default' : 'ghost'} size="icon" className="h-8 w-8"
                  onClick={() => setTextBold(!textBold)}
                >
                  <Bold className="h-3.5 w-3.5" />
                </Button>
                <Button variant={textItalic ? 'default' : 'ghost'} size="icon" className="h-8 w-8"
                  onClick={() => setTextItalic(!textItalic)}
                >
                  <Italic className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Sticky note tool */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              className={cn(
                'h-10 w-10 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-200',
                tool === 'sticky'
                  ? 'bg-primary/15 text-primary shadow-[0_2px_8px_-2px_hsl(var(--primary)/0.4),inset_0_1px_1px_hsl(var(--primary-foreground)/0.1)] scale-105'
                  : 'text-foreground/70 hover:bg-muted/80 hover:text-foreground hover:shadow-[0_2px_6px_-2px_hsl(var(--foreground)/0.1)] active:scale-95'
              )}
              onClick={() => { setTool('sticky'); setEyedropperActive(false); }}
            >
              <StickyNote className="h-5 w-5" strokeWidth={tool === 'sticky' ? 2.5 : 1.8} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3 bg-card" align="start" side="top">
            <p className="text-[10px] font-medium text-foreground mb-2">Sticky Note Color</p>
            <div className="flex gap-1.5 flex-wrap">
              {STICKY_COLORS.map(c => (
                <button
                  key={c}
                  className={cn('w-8 h-8 rounded-lg border-2 transition-transform active:scale-90 shadow-sm',
                    stickyColor === c ? 'border-primary scale-110' : 'border-border')}
                  style={{ backgroundColor: c }}
                  onClick={() => setStickyColor(c)}
                />
              ))}
            </div>
            <p className="text-[9px] text-muted-foreground mt-2">Tap canvas to place a sticky note</p>
          </PopoverContent>
        </Popover>

        {/* Image tool */}
        <button
          className={cn(
            'h-10 w-10 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-200',
            'text-foreground/70 hover:bg-muted/80 hover:text-foreground hover:shadow-[0_2px_6px_-2px_hsl(var(--foreground)/0.1)] active:scale-95'
          )}
          onClick={() => imageInputRef.current?.click()}
        >
          <ImagePlus className="h-5 w-5" strokeWidth={1.8} />
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImageUpload(file);
            e.target.value = '';
          }}
        />
        {/* SVG import input */}
        <input
          ref={svgInputRef}
          type="file"
          accept=".svg,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleSvgImport(file);
            e.target.value = '';
          }}
        />

        {/* Drawing tools popover */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              className={cn(
                'h-10 w-10 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-200',
                activeDrawTool
                  ? 'bg-primary/15 text-primary shadow-[0_2px_8px_-2px_hsl(var(--primary)/0.4),inset_0_1px_1px_hsl(var(--primary-foreground)/0.1)] scale-105'
                  : 'text-foreground/70 hover:bg-muted/80 hover:text-foreground hover:shadow-[0_2px_6px_-2px_hsl(var(--foreground)/0.1)] active:scale-95'
              )}
            >
              {activeDrawTool ? <activeDrawTool.icon className="h-5 w-5" strokeWidth={2.5} /> : <Pen className="h-5 w-5" strokeWidth={1.8} />}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2.5 bg-card/95 backdrop-blur-md border border-border/50 shadow-xl rounded-2xl" align="start" side="top">
            <div className="grid grid-cols-2 gap-1.5" style={{ width: 280 }}>
              {DRAW_TOOLS.map((d) => (
                <button key={d.id}
                  className={cn(
                    'flex flex-col items-center gap-1 p-2 rounded-xl transition-all duration-200',
                    tool === d.id
                      ? 'bg-primary/15 text-primary shadow-[0_2px_8px_-2px_hsl(var(--primary)/0.3)]'
                      : 'text-foreground/70 hover:bg-muted/80 hover:text-foreground active:scale-95'
                  )}
                  onClick={() => { setTool(d.id); setEyedropperActive(false); }}
                >
                  <div className="flex items-center gap-1.5 w-full">
                    <d.icon className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={tool === d.id ? 2.5 : 1.8} />
                    <span className="text-[10px] font-medium">{d.label}</span>
                  </div>
                  <PenPreviewCanvas penType={d.id} isActive={tool === d.id} currentColor={color} />
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Eraser */}
        <button
          className={cn(
            'h-10 w-10 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-200',
            tool === 'eraser'
              ? 'bg-primary/15 text-primary shadow-[0_2px_8px_-2px_hsl(var(--primary)/0.4),inset_0_1px_1px_hsl(var(--primary-foreground)/0.1)] scale-105'
              : 'text-foreground/70 hover:bg-muted/80 hover:text-foreground hover:shadow-[0_2px_6px_-2px_hsl(var(--foreground)/0.1)] active:scale-95'
          )}
          onClick={() => { setTool('eraser'); setEyedropperActive(false); }}
        >
          <Eraser className="h-5 w-5" strokeWidth={tool === 'eraser' ? 2.5 : 1.8} />
        </button>

        {/* Shape tools popover */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              className={cn(
                'h-10 w-10 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-200',
                activeShapeTool
                  ? 'bg-primary/15 text-primary shadow-[0_2px_8px_-2px_hsl(var(--primary)/0.4),inset_0_1px_1px_hsl(var(--primary-foreground)/0.1)] scale-105'
                  : 'text-foreground/70 hover:bg-muted/80 hover:text-foreground hover:shadow-[0_2px_6px_-2px_hsl(var(--foreground)/0.1)] active:scale-95'
              )}
            >
              {activeShapeTool
                ? <activeShapeTool.icon className={cn('h-5 w-5', activeShapeTool.id === 'line' && '-rotate-45')} strokeWidth={2.5} />
                : <Square className="h-5 w-5" strokeWidth={1.8} />}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2.5 bg-card/95 backdrop-blur-md border border-border/50 shadow-xl rounded-2xl" align="start" side="top">
            <div className="grid grid-cols-6 gap-1.5 mb-2.5" style={{ width: 270 }}>
              {SHAPE_TOOLS.map((s) => (
                <button key={s.id}
                  className={cn(
                    'h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-200',
                    tool === s.id
                      ? 'bg-primary/15 text-primary shadow-[0_2px_8px_-2px_hsl(var(--primary)/0.3)] scale-105'
                      : 'text-foreground/70 hover:bg-muted/80 hover:text-foreground active:scale-95'
                  )}
                  onClick={() => { setTool(s.id); setEyedropperActive(false); }} title={s.label}
                >
                  <s.icon className={cn('h-5 w-5', s.id === 'line' && '-rotate-45')} strokeWidth={tool === s.id ? 2.5 : 1.8} />
                </button>
              ))}
            </div>
            <div className="border-t border-border pt-2 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground">Fill Color</p>
                <button
                  className={cn('w-5 h-5 rounded border-2 transition-colors', fillEnabled ? 'border-primary' : 'border-border')}
                  style={{ backgroundColor: fillEnabled ? hexToRgba(fillColor, fillOpacity) : 'transparent' }}
                  onClick={() => setFillEnabled(!fillEnabled)}
                  title={fillEnabled ? 'Disable fill' : 'Enable fill'}
                />
              </div>
              {fillEnabled && (
                <>
                  <div className="flex gap-1 flex-wrap">
                    {['#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316','#1a1a1a','#ffffff'].map(c => (
                      <button key={c}
                        className={cn('w-5 h-5 rounded-full border-2 transition-transform active:scale-90',
                          fillColor === c ? 'border-primary scale-110' : 'border-border')}
                        style={{ backgroundColor: c }}
                        onClick={() => setFillColor(c)}
                      />
                    ))}
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">Fill Opacity: {Math.round(fillOpacity * 100)}%</p>
                    <Slider min={5} max={100} step={5} value={[Math.round(fillOpacity * 100)]} onValueChange={([v]) => setFillOpacity(v / 100)} />
                  </div>
                </>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Advanced color picker */}
        <Popover>
          <PopoverTrigger asChild>
            <button className="h-10 w-10 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-200 text-foreground/70 hover:bg-muted/80 hover:text-foreground hover:shadow-[0_2px_6px_-2px_hsl(var(--foreground)/0.1)] active:scale-95 relative">
              <Palette className="h-5 w-5" strokeWidth={1.8} />
              <span className="absolute bottom-1.5 right-1.5 w-2.5 h-2.5 rounded-full border border-border shadow-sm" style={{ backgroundColor: color }} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3 bg-card" align="start" side="top">
            <HslColorWheel hue={hslH} saturation={hslS} lightness={hslL}
              onHueChange={(h) => handleHslChange(h, hslS, hslL)}
              onSatLightChange={(s, l) => handleHslChange(hslH, s, l)}
            />
            <div className="flex items-center gap-2 mt-2 mb-2">
              <div className="w-8 h-8 rounded-lg border border-border flex-shrink-0" style={{ backgroundColor: color }} />
              <input type="text" value={color}
                onChange={(e) => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) applyColor(e.target.value); }}
                className="flex-1 text-xs font-mono bg-muted rounded px-2 py-1 border border-border text-foreground w-20"
                maxLength={7}
              />
              <Button variant={eyedropperActive ? 'default' : 'outline'} size="icon" className="h-8 w-8 flex-shrink-0"
                onClick={() => setEyedropperActive(!eyedropperActive)} title="Eyedropper"
              >
                <Pipette className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="mb-2">
              <p className="text-[10px] text-muted-foreground mb-1">Opacity: {Math.round(toolOpacity * 100)}%</p>
              <Slider min={5} max={100} step={5} value={[Math.round(toolOpacity * 100)]} onValueChange={([v]) => setToolOpacity(v / 100)} />
            </div>
            {recentColors.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Recent</p>
                <div className="flex gap-1.5 flex-wrap">
                  {recentColors.map((c, i) => (
                    <button key={`${c}-${i}`}
                      className={cn('w-6 h-6 rounded-full border-2 transition-transform active:scale-90',
                        color === c ? 'border-primary scale-110' : 'border-border')}
                      style={{ backgroundColor: c }} onClick={() => applyColor(c)}
                    />
                  ))}
                </div>
              </div>
            )}
            {/* Palette Manager */}
            <div className="mt-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-medium text-foreground">Palettes</p>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={addCurrentColorToPalette} title="Add current color to palette">
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              {/* Palette tabs */}
              <div className="flex gap-1 mb-1.5 overflow-x-auto">
                {savedPalettes.map((p, idx) => (
                  <button
                    key={idx}
                    className={cn('text-[9px] px-2 py-0.5 rounded-full whitespace-nowrap transition-colors',
                      activePaletteIdx === idx ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    )}
                    onClick={() => setActivePaletteIdx(idx)}
                    onDoubleClick={() => { if (savedPalettes.length > 1) deletePalette(idx); }}
                    title={`${p.name} (double-click to delete)`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              {/* Active palette colors */}
              {savedPalettes[activePaletteIdx] && (
                <div className="flex gap-1.5 flex-wrap">
                  {savedPalettes[activePaletteIdx].colors.map((c, i) => (
                    <button key={`pal-${c}-${i}`}
                      className={cn('w-6 h-6 rounded-full border-2 transition-transform active:scale-90 relative group',
                        color === c ? 'border-primary scale-110' : 'border-border')}
                      style={{ backgroundColor: c }}
                      onClick={() => applyColor(c)}
                      onContextMenu={(e) => { e.preventDefault(); removeColorFromPalette(c); }}
                      title={`${c} (right-click to remove)`}
                    />
                  ))}
                </div>
              )}
              {/* New palette input */}
              <div className="flex gap-1 mt-1.5">
                <input
                  type="text"
                  value={newPaletteName}
                  onChange={(e) => setNewPaletteName(e.target.value)}
                  placeholder="New palette..."
                  className="flex-1 text-[10px] bg-muted rounded px-2 py-0.5 border border-border text-foreground"
                  onKeyDown={(e) => { if (e.key === 'Enter') createNewPalette(newPaletteName); }}
                />
                <Button variant="outline" size="sm" className="h-5 text-[9px] px-1.5" onClick={() => createNewPalette(newPaletteName)} disabled={!newPaletteName.trim()}>
                  <Save className="h-2.5 w-2.5" />
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Stroke width */}
        <Popover>
          <PopoverTrigger asChild>
            <button className="h-10 w-10 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-200 text-foreground/70 hover:bg-muted/80 hover:text-foreground hover:shadow-[0_2px_6px_-2px_hsl(var(--foreground)/0.1)] active:scale-95">
              <Minus className="h-5 w-5" strokeWidth={strokeWidth > 8 ? 4 : 2} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-3 bg-card" align="center" side="top">
            <p className="text-xs text-muted-foreground mb-2">{t('common.size', 'Size')}: {strokeWidth}px</p>
            <Slider min={1} max={20} step={1} value={[strokeWidth]} onValueChange={([v]) => setStrokeWidth(v)} />
          </PopoverContent>
        </Popover>

        {/* Background selector */}
        <Popover>
          <PopoverTrigger asChild>
            <button className="h-10 w-10 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-200 text-foreground/70 hover:bg-muted/80 hover:text-foreground hover:shadow-[0_2px_6px_-2px_hsl(var(--foreground)/0.1)] active:scale-95"><Grid3X3 className="h-5 w-5" strokeWidth={1.8} /></button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2 bg-card" align="center" side="top">
            <p className="text-[10px] font-medium text-foreground mb-1.5 px-1">Background</p>
            <div className="grid grid-cols-4 gap-1">
              {BACKGROUNDS.map((bg) => (
                <Button key={bg.id} variant={background === bg.id ? 'default' : 'ghost'} size="sm"
                  className="h-8 text-[10px] px-2" onClick={() => handleBackgroundChange(bg.id)}>{bg.label}</Button>
              ))}
            </div>
            {background !== 'plain' && background !== 'dark' && (
              <>
                <div className="mt-2 pt-2 border-t border-border px-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-muted-foreground">Grid Color</span>
                    <input type="color" value={gridColor} onChange={(e) => setGridColor(e.target.value)}
                      className="w-6 h-6 rounded border border-border cursor-pointer" style={{ padding: 0 }} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Opacity: {Math.round(gridOpacity * 100)}%</span>
                  </div>
                  <Slider min={5} max={100} step={5} value={[Math.round(gridOpacity * 100)]}
                    onValueChange={([v]) => setGridOpacity(v / 100)} className="mt-1" />
                </div>
              </>
            )}
            <div className="mt-2 pt-2 border-t border-border flex items-center justify-between px-1">
              <span className="text-[10px] text-muted-foreground">Snap to Grid</span>
              <Button variant={snapEnabled ? 'default' : 'outline'} size="sm" className="h-6 text-[10px] px-2"
                onClick={() => setSnapEnabled(!snapEnabled)}>{snapEnabled ? 'ON' : 'OFF'}</Button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Layers popover */}
        <Popover>
          <PopoverTrigger asChild>
            <button className="h-10 w-10 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-200 text-foreground/70 hover:bg-muted/80 hover:text-foreground hover:shadow-[0_2px_6px_-2px_hsl(var(--foreground)/0.1)] active:scale-95"><Layers className="h-5 w-5" strokeWidth={1.8} /></button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3 bg-card" align="center" side="top">
            <p className="text-xs font-medium text-foreground mb-2">Layers</p>
            <div className="flex flex-col gap-2">
              {[...layers].reverse().map((layer) => (
                <div key={layer.id}
                  className={cn('flex items-center gap-2 p-1.5 rounded-lg border transition-colors cursor-pointer',
                    activeLayerId === layer.id ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-muted/50')}
                  onClick={() => setActiveLayerId(layer.id)}
                >
                  <button className="flex-shrink-0 p-0.5"
                    onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
                  >
                    {layer.visible ? <Eye className="h-3.5 w-3.5 text-muted-foreground" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground/50" />}
                  </button>
                  <span className={cn('text-xs flex-1 truncate', !layer.visible && 'text-muted-foreground/50')}>{layer.name}</span>
                  <span className="text-[10px] text-muted-foreground">{layer.strokes.length + (layer.textAnnotations?.length || 0) + (layer.stickyNotes?.length || 0)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-2 border-t border-border">
              <p className="text-[10px] text-muted-foreground mb-1.5">
                Opacity: {Math.round((layers.find(l => l.id === activeLayerId)?.opacity ?? 1) * 100)}%
              </p>
              <Slider min={0} max={100} step={5}
                value={[Math.round((layers.find(l => l.id === activeLayerId)?.opacity ?? 1) * 100)]}
                onValueChange={([v]) => setLayerOpacity(activeLayerId, v / 100)}
              />
            </div>
          </PopoverContent>
        </Popover>

        {/* Ruler toggle */}
        <button
          className={cn(
            'h-10 w-10 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-200',
            showRulers
              ? 'bg-primary/15 text-primary shadow-[0_2px_8px_-2px_hsl(var(--primary)/0.4)] scale-105'
              : 'text-foreground/70 hover:bg-muted/80 hover:text-foreground hover:shadow-[0_2px_6px_-2px_hsl(var(--foreground)/0.1)] active:scale-95'
          )}
          onClick={() => setShowRulers(!showRulers)}
          title={showRulers ? 'Hide Rulers' : 'Show Rulers'}
        >
          <Ruler className="h-5 w-5" strokeWidth={showRulers ? 2.5 : 1.8} />
        </button>

        {/* Focus mode toggle */}
        <button
          className={cn(
            'h-10 w-10 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-200',
            focusMode
              ? 'bg-primary/15 text-primary shadow-[0_2px_8px_-2px_hsl(var(--primary)/0.4)] scale-105'
              : 'text-foreground/70 hover:bg-muted/80 hover:text-foreground hover:shadow-[0_2px_6px_-2px_hsl(var(--foreground)/0.1)] active:scale-95'
          )}
          onClick={() => setFocusMode(!focusMode)}
          title={focusMode ? 'Exit Focus Mode' : 'Focus Mode'}
        >
          <Focus className="h-5 w-5" strokeWidth={focusMode ? 2.5 : 1.8} />
        </button>

        <div className="flex-1" />

        <button className="h-10 w-10 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-200 text-foreground/70 hover:bg-muted/80 hover:text-foreground hover:shadow-[0_2px_6px_-2px_hsl(var(--foreground)/0.1)] active:scale-95" onClick={handleUndo}>
          <Undo2 className="h-5 w-5" strokeWidth={1.8} />
        </button>
        <button className="h-10 w-10 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-200 text-foreground/70 hover:bg-muted/80 hover:text-foreground hover:shadow-[0_2px_6px_-2px_hsl(var(--foreground)/0.1)] active:scale-95" onClick={handleRedo}>
          <Redo2 className="h-5 w-5" strokeWidth={1.8} />
        </button>
        <button className="h-10 w-10 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-200 text-destructive/70 hover:bg-destructive/10 hover:text-destructive hover:shadow-[0_2px_6px_-2px_hsl(var(--destructive)/0.2)] active:scale-95" onClick={handleClear}>
          <Trash2 className="h-5 w-5" strokeWidth={1.8} />
        </button>

        {/* Export popover */}
        <Popover>
          <PopoverTrigger asChild>
            <button className="h-10 w-10 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-200 border border-border/50 text-foreground/70 hover:bg-muted/80 hover:text-foreground hover:shadow-[0_2px_6px_-2px_hsl(var(--foreground)/0.1)] active:scale-95">
              <Download className="h-5 w-5" strokeWidth={1.8} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2 bg-card" align="end" side="top">
            <div className="flex flex-col gap-1">
              {onImageExport && (
                <Button variant="ghost" size="sm" className="h-8 text-xs justify-start gap-2 px-2" onClick={handleExportPng}>
                  <FileImage className="h-3.5 w-3.5" />Insert PNG
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-8 text-xs justify-start gap-2 px-2" onClick={handleDownloadPng}>
                <FileImage className="h-3.5 w-3.5" />Download PNG
              </Button>
              <Button variant="ghost" size="sm" className="h-8 text-xs justify-start gap-2 px-2" onClick={handleExportSvg}>
                <FileCode className="h-3.5 w-3.5" />Export SVG
              </Button>
              <Button variant="ghost" size="sm" className="h-8 text-xs justify-start gap-2 px-2" onClick={handleExportPdf}>
                <FileText className="h-3.5 w-3.5" />Export PDF
              </Button>
              <Button variant="ghost" size="sm" className="h-8 text-xs justify-start gap-2 px-2" onClick={handleNativeShare}>
                <Share2 className="h-3.5 w-3.5" />Share
              </Button>
              <div className="border-t border-border my-1" />
              <Button variant="ghost" size="sm" className="h-8 text-xs justify-start gap-2 px-2" onClick={() => svgInputRef.current?.click()}>
                <FileCode className="h-3.5 w-3.5" />Import SVG
              </Button>
              <Button variant="ghost" size="sm" className="h-8 text-xs justify-start gap-2 px-2" onClick={handleTimelapseReplay}>
                {isPlayingTimelapse ? <><Trash2 className="h-3.5 w-3.5" />Stop Timelapse</> : <><Film className="h-3.5 w-3.5" />Timelapse Replay</>}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
});

SketchEditor.displayName = 'SketchEditor';
