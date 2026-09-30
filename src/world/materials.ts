/** Общие помощники материалов: emissive-канал для bloom (MRT). */
import type { NodeMaterial } from 'three/webgpu';
import { mrt } from 'three/tsl';
import type { Node } from 'three/webgpu';

/**
 * Задаёт свечение материала только в emissive-канале MRT (bloom), не меняя
 * основной цвет. Без bloom (низкое качество) MRT не используется — не влияет.
 */
export function setGlow(mat: NodeMaterial, node: Node): void {
  mat.mrtNode = mrt({ emissive: node });
}
