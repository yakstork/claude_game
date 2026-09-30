/** Общие помощники материалов: emissive-канал для bloom (MRT). */
import type { Node, NodeMaterial } from 'three/webgpu';
import { mrt } from 'three/tsl';

const glowMaterials = new Map<NodeMaterial, Node>();
let glowEnabled = true;

/**
 * Задаёт свечение материала только в emissive-канале MRT (bloom), не меняя
 * основной цвет. Когда bloom выключен (низкое качество), mrtNode снимается:
 * без MRT-пайплайна у материала был бы лишь выход emissive без основного цвета.
 */
export function setGlow(mat: NodeMaterial, node: Node): void {
  glowMaterials.set(mat, node);
  mat.mrtNode = glowEnabled ? mrt({ emissive: node }) : null;
  mat.addEventListener('dispose', () => glowMaterials.delete(mat));
}

/** Вызывается рендер-системой при включении/выключении bloom */
export function setGlowEnabled(enabled: boolean): void {
  if (enabled === glowEnabled) return;
  glowEnabled = enabled;
  for (const [mat, node] of glowMaterials) {
    mat.mrtNode = enabled ? mrt({ emissive: node }) : null;
    mat.needsUpdate = true;
  }
}
