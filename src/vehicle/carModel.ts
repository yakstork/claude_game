/**
 * Низкополигональные модели машин: кузов (клин / маслкар / гиперкар), кабина,
 * колёса с неоновым ободом, спойлер, фары/стопы, неоновая подсветка днища.
 * Носом по +Z, +X — влево, y = 0 — уровень осей колёс (как в CAR_GEOMETRY).
 */
import {
  AdditiveBlending,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import { abs, attribute, color, float, length, max, oneMinus, pow, sin, smoothstep, time, uniform, uv, vertexColor } from 'three/tsl';
import type { CarModelKind, VehicleState } from '../core/types';
import { GeometryBuilder } from '../world/geometryBuilder';
import { setGlow } from '../world/materials';
import { PALETTE } from '../world/palette';
import { CAR_GEOMETRY } from './specs';

export interface CarLook {
  model: CarModelKind;
  bodyColor: number;
  neonColor: number;
  accentColor: number;
}

const GLASS = 0x120726;
const TIRE = 0x0e0a16;
const DARK = 0x1a1026;
const HEAD = 0xfff4d6;
const TAIL = 0xff1f4f;
const EXHAUST_X = 0.45;
const EXHAUST_Y = 0.02;

const T = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);

function buildBody(look: CarLook): GeometryBuilder {
  const gb = new GeometryBuilder();
  const body = new Color(look.bodyColor);
  const bodyDark = body.clone().multiplyScalar(0.62);
  const neon = look.neonColor;
  const accent = new Color(look.accentColor);
  const hw = CAR_GEOMETRY.width / 2;

  if (look.model === 'wedge') {
    // Razor 86 — острый клин 80-х
    gb.prism(
      [
        [-2.15, -0.12],
        [2.2, -0.12],
        [2.25, 0.08],
        [1.2, 0.42],
        [-1.9, 0.62],
        [-2.2, 0.55],
      ],
      hw,
      body,
      0,
      undefined,
      0.08,
      bodyDark,
    );
    // кабина
    gb.prism(
      [
        [-1.2, 0.5],
        [0.95, 0.46],
        [-0.15, 1.02],
        [-1.05, 1.0],
      ],
      hw * 0.74,
      GLASS,
      0,
      undefined,
      0.18,
    );
    // жабры-воздухозаборники по бокам
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) gb.box(0.02, 0.06, 0.55, DARK, 0, T(side * (hw + 0.005), 0.3 + i * 0.1, -1.0));
    }
    // спойлер
    gb.box(hw * 2.05, 0.06, 0.42, accent.getHex() === PALETTE.void ? DARK : accent, 0, T(0, 0.98, -1.95));
    for (const side of [-1, 1]) gb.box(0.08, 0.36, 0.3, DARK, 0, T(side * hw * 0.75, 0.78, -1.9));
    gb.box(hw * 2.05, 0.03, 0.06, neon, 1, T(0, 1.02, -2.14));
    // фары-щели и стопы
    gb.box(hw * 1.5, 0.05, 0.05, HEAD, 1, T(0, 0.12, 2.22));
    gb.box(hw * 1.8, 0.1, 0.05, TAIL, 1, T(0, 0.45, -2.21));
  } else if (look.model === 'muscle') {
    // Grizzly V8 — высокий брутальный маслкар
    gb.prism(
      [
        [-2.2, -0.14],
        [2.25, -0.14],
        [2.3, 0.52],
        [0.6, 0.62],
        [-2.1, 0.66],
        [-2.25, 0.5],
      ],
      hw * 1.02,
      body,
      0,
      undefined,
      0.04,
      bodyDark,
    );
    // кабина фастбэк
    gb.prism(
      [
        [-1.75, 0.62],
        [0.45, 0.6],
        [-0.25, 1.18],
        [-0.95, 1.2],
      ],
      hw * 0.8,
      GLASS,
      0,
      undefined,
      0.12,
    );
    // воздухозаборник на капоте
    gb.prism(
      [
        [0.4, 0.6],
        [1.5, 0.6],
        [1.5, 0.66],
        [0.55, 0.84],
      ],
      0.34,
      DARK,
    );
    gb.box(0.6, 0.04, 0.04, neon, 1, T(0, 0.8, 0.6));
    // гоночные полосы
    for (const side of [-1, 1]) gb.box(0.18, 0.012, 1.7, accent, 0.25, T(side * 0.22, 0.63, 1.35));
    // решётка радиатора и фары
    gb.box(hw * 1.6, 0.3, 0.04, DARK, 0, T(0, 0.3, 2.28));
    for (const side of [-1, 1]) gb.box(0.28, 0.14, 0.05, HEAD, 1, T(side * hw * 0.68, 0.32, 2.3));
    // утиный хвост
    gb.prism(
      [
        [-2.25, 0.62],
        [-1.7, 0.66],
        [-2.3, 0.86],
      ],
      hw,
      body,
    );
    gb.box(hw * 1.9, 0.12, 0.05, TAIL, 1, T(0, 0.5, -2.26));
  } else if (look.model === 'hatch') {
    // Volt Rider — короткий раллийный хэтч: высокая кабина, крыло, фары на крыше
    gb.prism(
      [
        [-2.0, -0.12],
        [2.05, -0.12],
        [2.1, 0.12],
        [1.5, 0.4],
        [-1.95, 0.55],
        [-2.05, 0.4],
      ],
      hw * 1.01,
      body,
      0,
      undefined,
      0.06,
      bodyDark,
    );
    // высокая кабина с отвесной кормой
    gb.prism(
      [
        [-1.85, 0.5],
        [0.9, 0.44],
        [0.2, 1.1],
        [-1.8, 1.14],
      ],
      hw * 0.8,
      GLASS,
      0,
      undefined,
      0.1,
    );
    gb.box(hw * 1.5, 0.06, 1.9, body, 0, T(0, 1.14, -0.8));
    // гоночная полоса по капоту и крыше
    gb.box(0.4, 0.012, 1.7, accent, 0, T(0, 0.43, 1.0));
    gb.box(0.4, 0.014, 1.9, accent, 0, T(0, 1.18, -0.8));
    // воздухозаборник на капоте с неоном
    gb.prism(
      [
        [0.5, 0.42],
        [1.3, 0.38],
        [1.3, 0.44],
        [0.6, 0.58],
      ],
      0.3,
      DARK,
    );
    gb.box(0.5, 0.03, 0.04, neon, 1, T(0, 0.52, 0.65));
    // фары-прожекторы на крыше
    for (let i = -1; i <= 1; i += 2) {
      for (const k of [0.45, 1.0]) {
        gb.cylinder(0.12, 0.12, 0.08, 8, HEAD, 1, new Matrix4().makeRotationX(Math.PI / 2).premultiply(T(i * k * 0.5 - i * 0.0, 1.26, 0.18)));
      }
    }
    gb.box(hw * 1.2, 0.06, 0.1, DARK, 0, T(0, 1.2, 0.1));
    // большое заднее крыло на стойках
    gb.box(hw * 2.0, 0.07, 0.5, accent.getHex() === PALETTE.void ? DARK : accent, 0, T(0, 1.34, -2.0));
    for (const side of [-1, 1]) {
      gb.box(0.08, 0.3, 0.3, DARK, 0, T(side * hw * 0.7, 1.2, -1.95));
      gb.box(0.05, 0.2, 0.55, body, 0, T(side * hw * 1.0, 1.36, -2.0));
    }
    gb.box(hw * 2.0, 0.03, 0.05, neon, 1, T(0, 1.38, -2.27));
    // расширители арок
    for (const side of [-1, 1]) {
      for (const z of [1.3, -1.3]) gb.box(0.1, 0.12, 1.0, bodyDark, 0, T(side * (hw * 1.01 + 0.04), 0.3, z));
    }
    // фары, стопы
    gb.box(hw * 1.5, 0.06, 0.05, HEAD, 1, T(0, 0.26, 2.12));
    gb.box(hw * 1.7, 0.1, 0.05, TAIL, 1, T(0, 0.34, -2.07));
  } else if (look.model === 'limo') {
    // Nightshade LX — длинный ретро-футуристичный GT-люкс: длинный капот, плавники, световая лента
    gb.prism(
      [
        [-2.45, -0.12],
        [2.5, -0.12],
        [2.55, 0.08],
        [1.7, 0.4],
        [-2.3, 0.56],
        [-2.5, 0.44],
      ],
      hw * 1.03,
      body,
      0,
      undefined,
      0.06,
      bodyDark,
    );
    // длинная низкая кабина, смещённая назад
    gb.prism(
      [
        [-1.9, 0.54],
        [0.55, 0.48],
        [-0.1, 0.98],
        [-1.6, 1.0],
      ],
      hw * 0.78,
      GLASS,
      0,
      undefined,
      0.14,
    );
    gb.box(hw * 1.5, 0.05, 1.5, accent, 0, T(0, 1.0, -0.85));
    // плавники на задних крыльях с неоновой кромкой
    for (const side of [-1, 1]) {
      gb.prism(
        [
          [-2.45, 0.5],
          [-1.5, 0.54],
          [-2.5, 0.88],
        ],
        0.05,
        body,
        0,
        T(side * hw * 0.92, 0, 0),
      );
      gb.box(0.03, 0.03, 0.95, neon, 1, T(side * hw * 0.92, 0.52, -1.95));
      // длинная неоновая линия по борту
      gb.box(0.02, 0.03, 3.8, neon, 1, T(side * (hw * 1.03 + 0.01), 0.28, 0.05));
      // хромированные боковые вставки
      gb.box(0.02, 0.1, 1.2, DARK, 0, T(side * (hw * 1.03 + 0.005), 0.14, 1.2));
    }
    // световая лента на корме и фары-щели с капотным «стрелком»
    gb.box(hw * 1.9, 0.06, 0.05, TAIL, 1, T(0, 0.46, -2.5));
    gb.box(0.14, 0.02, 1.9, neon, 1, T(0, 0.46, 1.1));
    for (const side of [-1, 1]) gb.box(0.55, 0.05, 0.05, HEAD, 1, T(side * hw * 0.58, 0.22, 2.56));
    gb.box(hw * 1.4, 0.1, 0.04, DARK, 0, T(0, 0.14, 2.55));
  } else if (look.model === 'custom') {
    // «Своя сборка» — ретро-футуристичный шутинг-брейк: длинная крыша до кормы,
    // рубленая корма, крылья-обтекатели над колёсами и световая балка на крыше
    gb.prism(
      [
        [-2.1, -0.14],
        [2.2, -0.14],
        [2.28, 0.1],
        [2.0, 0.34],
        [0.9, 0.46],
        [-2.05, 0.5],
        [-2.12, 0.3],
      ],
      hw,
      body,
      0,
      undefined,
      0.05,
      bodyDark,
    );
    // длинная кабина-«универсал» со стеклом до самой кормы
    gb.prism(
      [
        [-1.95, 0.48],
        [0.85, 0.45],
        [0.05, 1.0],
        [-1.9, 1.02],
      ],
      hw * 0.82,
      GLASS,
      0,
      undefined,
      0.08,
    );
    // крыша-рама поверх стекла и световая балка
    gb.box(hw * 1.66, 0.06, 1.95, body, 0, T(0, 1.04, -0.95));
    gb.box(hw * 1.3, 0.12, 0.22, DARK, 0, T(0, 1.13, -0.1));
    for (let i = -2; i <= 2; i++) gb.box(0.2, 0.08, 0.05, HEAD, 1, T(i * hw * 0.26, 1.14, 0.02));
    // обтекатели колёс с неоновой кромкой
    for (const side of [-1, 1]) {
      for (const z of [1.3, -1.3]) {
        gb.prism(
          [
            [z - 0.62, 0.18],
            [z + 0.62, 0.18],
            [z + 0.42, 0.42],
            [z - 0.42, 0.42],
          ],
          0.1,
          bodyDark,
          0,
          T(side * (hw + 0.06), 0, 0),
        );
        gb.box(0.02, 0.03, 1.1, neon, 1, T(side * (hw + 0.17), 0.2, z));
      }
    }
    // решётка во всю ширину, узкие фары, корма с «мостом» стопов
    gb.box(hw * 1.7, 0.16, 0.04, DARK, 0, T(0, 0.12, 2.27));
    for (const side of [-1, 1]) gb.box(0.36, 0.06, 0.05, HEAD, 1, T(side * hw * 0.62, 0.24, 2.26));
    gb.box(hw * 1.9, 0.07, 0.05, TAIL, 1, T(0, 0.42, -2.12));
    for (const side of [-1, 1]) gb.box(0.07, 0.36, 0.05, TAIL, 1, T(side * hw * 0.9, 0.3, -2.12));
    gb.box(hw * 1.5, 0.05, 0.3, accent, 0, T(0, 1.02, -2.02));
  } else {
    // Photon X — очень низкий гиперкар с каплевидным фонарём
    gb.prism(
      [
        [-2.25, -0.14],
        [2.3, -0.14],
        [2.35, 0.02],
        [1.4, 0.3],
        [-0.2, 0.46],
        [-2.2, 0.5],
        [-2.3, 0.34],
      ],
      hw * 1.03,
      body,
      0,
      undefined,
      0.1,
      bodyDark,
    );
    gb.prism(
      [
        [-1.2, 0.44],
        [1.0, 0.36],
        [0.1, 0.9],
        [-0.8, 0.9],
      ],
      hw * 0.6,
      GLASS,
      0,
      undefined,
      0.3,
    );
    // кили
    for (const side of [-1, 1]) {
      gb.prism(
        [
          [-2.2, 0.48],
          [-0.9, 0.46],
          [-2.05, 0.95],
        ],
        0.04,
        body,
        0,
        T(side * hw * 0.6, 0, 0),
      );
      // боковые заборники с подсветкой
      gb.box(0.04, 0.14, 0.7, DARK, 0, T(side * (hw * 1.03 + 0.01), 0.18, -0.55));
      gb.box(0.02, 0.03, 0.7, neon, 1, T(side * (hw * 1.03 + 0.03), 0.27, -0.55));
    }
    // разделённое антикрыло
    gb.box(hw * 2.1, 0.05, 0.38, accent, 0, T(0, 0.98, -2.05));
    gb.box(hw * 2.1, 0.025, 0.05, neon, 1, T(0, 1.01, -2.25));
    gb.box(hw * 1.85, 0.05, 0.05, HEAD, 1, T(0, 0.06, 2.34));
    gb.box(hw * 2.0, 0.05, 0.05, TAIL, 1, T(0, 0.36, -2.29));
    gb.box(hw * 1.2, 0.18, 0.05, DARK, 0, T(0, 0.1, -2.3));
  }

  // ── общие детали: зеркала, неон окон, фары, диффузор, выхлоп, сплиттер ──
  const [front, rear] =
    look.model === 'wedge'
      ? [2.25, -2.2]
      : look.model === 'muscle'
        ? [2.3, -2.28]
        : look.model === 'custom'
          ? [2.28, -2.12]
          : look.model === 'hatch'
            ? [2.1, -2.05]
            : look.model === 'limo'
              ? [2.55, -2.5]
              : [2.35, -2.3];
  const cab =
    look.model === 'wedge'
      ? { z0: -1.15, z1: 0.9, y: 0.5, zm: 0.55, ym: 0.62, w: hw * 0.74 }
      : look.model === 'muscle'
        ? { z0: -1.7, z1: 0.42, y: 0.63, zm: 0.2, ym: 0.78, w: hw * 0.8 }
        : look.model === 'custom'
          ? { z0: -1.95, z1: 0.85, y: 0.48, zm: 0.55, ym: 0.62, w: hw * 0.82 }
          : look.model === 'hatch'
            ? { z0: -1.8, z1: 0.85, y: 0.46, zm: 0.6, ym: 0.62, w: hw * 0.8 }
            : look.model === 'limo'
              ? { z0: -1.7, z1: 0.5, y: 0.5, zm: 0.3, ym: 0.62, w: hw * 0.78 }
              : { z0: -1.15, z1: 0.95, y: 0.44, zm: 0.55, ym: 0.56, w: hw * 0.6 };
  for (const side of [-1, 1]) {
    // зеркала на стойке
    gb.box(0.05, 0.05, 0.12, DARK, 0, T(side * (cab.w + 0.08), cab.ym - 0.04, cab.zm));
    gb.box(0.18, 0.12, 0.06, body, 0, T(side * (cab.w + 0.18), cab.ym, cab.zm));
    // неоновая линия окна по низу кабины
    gb.box(0.02, 0.025, cab.z1 - cab.z0 - 0.2, neon, 1, T(side * (cab.w + 0.01), cab.y + 0.02, (cab.z0 + cab.z1) / 2));
  }
  if (look.model === 'wedge') {
    // выдвижные фары на капоте
    for (const side of [-1, 1]) {
      gb.box(0.46, 0.1, 0.3, bodyDark, 0, T(side * hw * 0.55, 0.31, 1.72));
      gb.box(0.4, 0.06, 0.03, HEAD, 1, T(side * hw * 0.55, 0.32, 1.88));
    }
    // жалюзи заднего стекла
    for (let i = 0; i < 4; i++) gb.box(hw * 1.2, 0.02, 0.05, DARK, 0, T(0, 0.66 + i * 0.03, -1.35 - i * 0.12));
  } else if (look.model === 'muscle') {
    // круглые фары + стопы по две с каждой стороны
    for (const side of [-1, 1]) {
      gb.cylinder(0.1, 0.1, 0.04, 8, HEAD, 1, new Matrix4().makeRotationX(Math.PI / 2).premultiply(T(side * hw * 0.42, 0.33, 2.3)));
      for (const k of [0.62, 0.36]) gb.box(0.24, 0.12, 0.05, TAIL, 1, T(side * hw * k, 0.5, -2.29));
    }
  } else if (look.model === 'hatch') {
    // круглые противотуманки в бампере и мудфлапы
    for (const side of [-1, 1]) {
      gb.cylinder(0.11, 0.11, 0.04, 8, HEAD, 1, new Matrix4().makeRotationX(Math.PI / 2).premultiply(T(side * hw * 0.62, 0.2, 2.12)));
      gb.box(0.03, 0.2, 0.22, DARK, 0, T(side * (hw * 1.01 + 0.02), 0.0, -1.0));
    }
  } else if (look.model === 'limo') {
    // детали уже в основном блоке
  } else if (look.model === 'custom') {
    // своя сборка: детали уже в основном блоке
  } else {
    // гиперкар: центральный стоп и заборник на крыше
    gb.box(0.3, 0.05, 0.05, TAIL, 1, T(0, 0.5, -2.2));
    gb.prism(
      [
        [-1.0, 0.88],
        [-0.3, 0.88],
        [-0.55, 1.02],
      ],
      0.14,
      DARK,
    );
  }
  // передний сплиттер с неоновой кромкой и решётка заборника
  gb.box(hw * 1.9, 0.04, 0.32, DARK, 0, T(0, -0.12, front - 0.08));
  gb.box(hw * 1.9, 0.02, 0.03, neon, 1, T(0, -0.1, front + 0.07));
  gb.box(hw * 1.1, 0.1, 0.03, 0x0a0612, 0, T(0, 0.0, front + 0.01));
  // диффузор с рёбрами
  gb.box(hw * 1.5, 0.14, 0.4, DARK, 0, T(0, -0.06, rear + 0.12));
  for (let i = -2; i <= 2; i++) gb.box(0.03, 0.2, 0.45, 0x2a2238, 0, T(i * hw * 0.3, -0.04, rear + 0.1));
  // выхлопные трубы (из них бьёт пламя нитро)
  for (const side of [-1, 1]) {
    gb.cylinder(0.1, 0.1, 0.28, 8, 0x3a3048, 0, new Matrix4().makeRotationX(Math.PI / 2).premultiply(T(side * EXHAUST_X, EXHAUST_Y, rear - 0.05)));
    gb.cylinder(0.065, 0.065, 0.02, 8, PALETTE.orange, 0.7, new Matrix4().makeRotationX(Math.PI / 2).premultiply(T(side * EXHAUST_X, EXHAUST_Y, rear - 0.2)));
  }
  // неоновая полоса по порогам, днище
  for (const side of [-1, 1]) gb.box(0.03, 0.04, 3.4, neon, 1, T(side * (hw + 0.02), -0.06, 0));
  gb.box(hw * 1.9, 0.08, 4.2, DARK, 0, T(0, -0.16, 0));
  return gb;
}

function buildWheel(neon: number): GeometryBuilder {
  const gb = new GeometryBuilder();
  const r = CAR_GEOMETRY.wheelRadius;
  const rot = new Matrix4().makeRotationZ(Math.PI / 2);
  gb.cylinder(r, r, 0.3, 10, TIRE, 0, rot);
  // обод и неоновое кольцо на внешней стороне (±X — обе стороны симметричны)
  for (const side of [-1, 1]) {
    gb.cylinder(r * 0.62, r * 0.62, 0.02, 10, 0x3a2a4a, 0, new Matrix4().makeRotationZ(Math.PI / 2).premultiply(T(side * 0.155, 0, 0)));
    gb.cylinder(r * 0.8, r * 0.8, 0.012, 10, neon, 1, new Matrix4().makeRotationZ(Math.PI / 2).premultiply(T(side * 0.152, 0, 0)));
    // колпак ступицы
    gb.cylinder(r * 0.2, r * 0.2, 0.04, 6, 0x6a5a7a, 0.15, new Matrix4().makeRotationZ(Math.PI / 2).premultiply(T(side * 0.175, 0, 0)));
    // спицы — видно вращение
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI;
      gb.box(0.03, r * 1.1, 0.07, 0x5a4a6a, 0, new Matrix4().makeRotationX(a).premultiply(T(side * 0.17, 0, 0)));
    }
  }
  return gb;
}

/** Общий материал машины: vertex colors + свечение по атрибуту glow */
function carMaterial(): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial({ roughness: 0.38, metalness: 0.2, flatShading: true });
  const g = attribute('glow', 'float');
  mat.colorNode = vertexColor();
  // неон — по атрибуту glow; кузову — лёгкий собственный подсвет, чтобы цвет читался в закатном свете
  mat.emissiveNode = vertexColor().mul(g.mul(2.2).add(float(1).sub(g).mul(0.12)));
  return mat;
}

const _q = new Quaternion();
const _v = new Vector3();
const _inv = new Matrix4();
const _m = new Matrix4();
const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);

export class CarModel {
  readonly group = new Group();
  readonly body: Mesh;
  readonly wheels: Mesh[] = [];
  private readonly underglow: Mesh;
  private readonly flame: Mesh;
  private readonly shadow: Mesh;
  private readonly flameIntensity = uniform(0);
  private readonly glowPulse = uniform(1);
  private readonly headBeam: Mesh;
  private readonly tailGlow: Group;
  private readonly tailPool: Mesh;
  private readonly lamp = uniform(0);
  private lampValue = 0;
  private lampCones = true;

  constructor(readonly look: CarLook) {
    const mat = carMaterial();
    this.body = new Mesh(buildBody(look).build(), mat);
    this.group.add(this.body);
    const wheelGeo = buildWheel(look.neonColor).build();
    for (const [x, y, z] of CAR_GEOMETRY.wheelOffsets) {
      const w = new Mesh(wheelGeo, mat);
      w.position.set(x * (x > 0 ? 1.0 : 1.0), y, z);
      this.wheels.push(w);
      this.group.add(w);
    }

    // неоновая подсветка днища: аддитивное пятно
    const ugMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    const d = length(uv().sub(0.5).mul(float(2.0)));
    const fall = oneMinus(smoothstep(0.2, 1.0, d));
    const neon = uniform(new Color(look.neonColor));
    ugMat.colorNode = neon.mul(fall).mul(this.glowPulse).mul(0.9);
    setGlow(ugMat, neon.mul(fall).mul(0.35));
    this.underglow = new Mesh(new PlaneGeometry(3.2, 5.6), ugMat);
    this.underglow.rotation.x = -Math.PI / 2;
    this.underglow.renderOrder = 2;
    this.group.add(this.underglow);

    // тень-блоб
    const shMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    shMat.colorNode = color(0x000000);
    shMat.opacityNode = oneMinus(smoothstep(0.35, 1.0, d)).mul(0.55);
    this.shadow = new Mesh(new PlaneGeometry(2.6, 5.0), shMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);

    const rearZ = look.model === 'wedge' ? -2.2 : look.model === 'muscle' ? -2.28 : look.model === 'custom' ? -2.12 : look.model === 'hatch' ? -2.05 : look.model === 'limo' ? -2.5 : -2.3;

    // фары: два световых конуса на дороге (аддитивная плоскость с градиентом, без SpotLight)
    const BEAM_W = 12;
    const BEAM_L = 24;
    const bu = uv();
    const bx = bu.x.sub(0.5).mul(BEAM_W);
    const bv = oneMinus(bu.y); // 0 у бампера → 1 вдали
    const spread = bv.mul(1.7).add(0.6);
    const lobe = (c: number) => smoothstep(spread, spread.mul(0.2), abs(bx.sub(c)));
    const beam = max(lobe(-0.72), lobe(0.72)).mul(pow(oneMinus(bv), 1.7)).mul(smoothstep(0.0, 0.05, bv));
    const hMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    hMat.colorNode = color(HEAD).mul(beam).mul(this.lamp).mul(0.42);
    setGlow(hMat, color(HEAD).mul(beam).mul(this.lamp).mul(0.18));
    this.headBeam = new Mesh(new PlaneGeometry(BEAM_W, BEAM_L), hMat);
    this.headBeam.rotation.x = -Math.PI / 2;
    this.headBeam.position.z = 2.2 + BEAM_L / 2;
    this.headBeam.renderOrder = 2;
    this.headBeam.visible = false;
    this.group.add(this.headBeam);

    // задние фонари: яркие пятна на кормовой стороне + красный отсвет на дороге
    this.tailGlow = new Group();
    const tMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    const td = length(uv().sub(0.5).mul(float(2.0)));
    const tf = oneMinus(smoothstep(0.0, 1.0, td));
    tMat.colorNode = color(TAIL).mul(tf).mul(this.lamp).mul(1.0);
    setGlow(tMat, color(TAIL).mul(tf).mul(this.lamp).mul(0.9));
    for (const side of [-0.62, 0.62]) {
      const q = new Mesh(new PlaneGeometry(1.1, 0.6), tMat);
      q.rotation.y = Math.PI;
      q.position.set(side, 0.45, rearZ - 0.05);
      q.renderOrder = 3;
      this.tailGlow.add(q);
    }
    const pMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    pMat.colorNode = color(TAIL).mul(tf).mul(this.lamp).mul(0.3);
    const pool = new Mesh(new PlaneGeometry(4.2, 6), pMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, -0.2, rearZ - 2.2);
    pool.scale.set(0.7, 1, 0.5);
    pool.renderOrder = 2;
    this.tailPool = pool;
    this.tailGlow.add(pool);
    this.tailGlow.visible = false;
    this.group.add(this.tailGlow);

    // пламя нитро (два конуса из выхлопа)
    const fg = new GeometryBuilder();
    for (const side of [-EXHAUST_X, EXHAUST_X]) {
      fg.cylinder(0.0, 0.16, 1.4, 6, PALETTE.cyan, 1, new Matrix4().makeRotationX(-Math.PI / 2).premultiply(T(side, EXHAUST_Y, rearZ - 0.95)));
      fg.cylinder(0.0, 0.09, 0.8, 6, PALETTE.white, 1, new Matrix4().makeRotationX(-Math.PI / 2).premultiply(T(side, EXHAUST_Y, rearZ - 0.62)));
      fg.cylinder(0.05, 0.2, 0.5, 6, PALETTE.magenta, 1, new Matrix4().makeRotationX(-Math.PI / 2).premultiply(T(side, EXHAUST_Y, rearZ - 0.45)));
    }
    const fMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    const flick = sin(time.mul(60.0)).mul(0.15).add(0.85);
    fMat.colorNode = vertexColor().mul(this.flameIntensity).mul(flick).mul(1.5);
    setGlow(fMat, vertexColor().mul(this.flameIntensity).mul(flick).mul(1.2));
    this.flame = new Mesh(fg.build(), fMat);
    this.flame.visible = false;
    this.group.add(this.flame);
  }

  /** Синхронизация с физическим состоянием (каждый кадр) */
  /**
   * Синхронизация с физическим состоянием (каждый кадр). pos/quat — интерполированная
   * поза кузова для рендера (по умолчанию — из state).
   */
  update(state: VehicleState, roadHeight: number, dt: number, pos: Vector3 = state.position, quat: Quaternion = state.quaternion): void {
    this.group.position.copy(pos);
    this.group.quaternion.copy(quat);
    this.group.updateMatrixWorld();
    _inv.copy(this.group.matrixWorld).invert();

    const r = CAR_GEOMETRY.wheelRadius;
    for (let i = 0; i < 4; i++) {
      const ws = state.wheels[i];
      const w = this.wheels[i];
      const [ox, , oz] = CAR_GEOMETRY.wheelOffsets[i];
      // центр колеса = точка контакта + радиус (в системе кузова). Ограничение —
      // только ходом подвески с запасом: колесо не должно «тонуть» в покрытии.
      _v.copy(ws.contact);
      if (_v.lengthSq() > 0) {
        _v.applyMatrix4(_inv);
        const y = Math.min(0.42, Math.max(-0.5, _v.y + r));
        w.position.set(ox, y, oz);
      } else {
        w.position.set(ox, 0, oz);
      }
      _q.setFromAxisAngle(Y_AXIS, ws.steerAngle);
      w.quaternion.copy(_q);
      _q.setFromAxisAngle(X_AXIS, ws.spin);
      w.quaternion.multiply(_q);
    }

    // подсветка и тень лежат на дороге под машиной
    const localGround = roadHeight - state.position.y;
    _m.makeTranslation(0, localGround + 0.06, 0);
    this.underglow.position.set(0, Math.max(-1.2, localGround) + 0.05, 0);
    this.shadow.position.set(0, Math.max(-1.2, localGround) + 0.03, 0);
    this.headBeam.position.y = Math.max(-1.2, localGround) + 0.07;
    this.tailPool.position.y = Math.max(-1.2, localGround) + 0.06;
    const air = Math.min(1, Math.max(0, -localGround - r) / 4);
    this.shadow.scale.setScalar(1 + air * 0.6);
    this.glowPulse.value = 0.85 + Math.sin(performance.now() * 0.004) * 0.15;

    const target = state.nitroActive ? 1 : 0;
    this.flameIntensity.value += (target - this.flameIntensity.value) * Math.min(1, dt * 12);
    this.flame.visible = this.flameIntensity.value > 0.02;
    this.flame.scale.set(1, 1, 0.7 + this.flameIntensity.value * 0.5 + Math.random() * 0.15);
  }

  /**
   * Фары и задние фонари: 0 — днём (как раньше), 1 — ночь/гроза.
   * cones=false (низкое качество) — без световых конусов на дороге.
   */
  setHeadlights(intensity: number, cones = true): void {
    if (intensity === this.lampValue && cones === this.lampCones) return;
    this.lampValue = intensity;
    this.lampCones = cones;
    this.lamp.value = intensity;
    this.headBeam.visible = intensity > 0.01 && cones;
    this.tailGlow.visible = intensity > 0.01;
  }

  /** Полупрозрачный «призрак» лучшего круга: без тени и пламени, не пишет глубину */
  setGhost(opacity: number): void {
    const mat = this.body.material as MeshStandardNodeMaterial;
    mat.transparent = true;
    mat.opacity = opacity;
    mat.depthWrite = false;
    mat.needsUpdate = true;
    this.shadow.visible = false;
    this.flame.visible = false;
    this.headBeam.visible = false;
    this.tailGlow.visible = false;
    this.group.renderOrder = 2;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
  }
}
