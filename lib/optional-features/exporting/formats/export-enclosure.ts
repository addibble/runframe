import type { CircuitJson } from "circuit-json"
import jscad from "@jscad/modeling"
import { executeJscadOperations } from "jscad-planner"
import * as stlSerializer from "@jscad/stl-serializer"
import JSZip from "jszip"
import { openForDownload } from "../open-for-download"
import { sanitizeFileName } from "lib/utils/sanitizeFileName"
import { toast } from "lib/utils/toast"

export interface EnclosurePartInfo {
  /** Stable id, e.g. "base", "lid", "sleeve", "cap_min", "cap_max". */
  partId: string
  /** Human label, e.g. "EN1 Base" (from cad_component.name). */
  name: string
  /** The jscad-planner plan to serialize. */
  modelJscad: any
}

/**
 * Enumerate the enclosure parts in a circuit. Enclosure parts are
 * `cad_component`s tagged with `enclosure_part_id` and a `model_jscad` plan
 * (emitted by the `pcb-enclosure` package). This is cheap (no geometry) so it
 * is safe to call while rendering the menu.
 */
export const getEnclosureParts = (
  circuitJson: CircuitJson,
): EnclosurePartInfo[] => {
  const parts: EnclosurePartInfo[] = []
  for (const element of circuitJson as any[]) {
    if (element?.type !== "cad_component") continue
    const partId = element.enclosure_part_id
    if (!partId || !element.model_jscad) continue
    parts.push({
      partId,
      name: element.name ?? String(partId),
      modelJscad: element.model_jscad,
    })
  }
  return parts
}

/**
 * Execute a `model_jscad` plan and serialize it to a binary STL Blob. Uses the
 * same `jscad-planner` + `@jscad/modeling` path the 3D viewer already bundles,
 * so no extra runtime download is needed.
 */
const modelJscadToStlBlob = (modelJscad: any): Blob => {
  const result = executeJscadOperations(jscad as any, modelJscad)
  const geometries = Array.isArray(result) ? result : [result]
  const serialize =
    (stlSerializer as any).serialize ?? (stlSerializer as any).default?.serialize
  const data = serialize({ binary: true }, ...geometries) as BlobPart[]
  return new Blob(data, { type: "model/stl" })
}

/** Download a single enclosure part as a binary STL. */
export const exportEnclosurePartStl = ({
  circuitJson,
  projectName,
  partId,
}: {
  circuitJson: CircuitJson
  projectName: string
  partId: string
}) => {
  const part = getEnclosureParts(circuitJson).find((p) => p.partId === partId)
  if (!part) {
    toast.error(`Enclosure part "${partId}" not found`)
    return
  }
  try {
    const blob = modelJscadToStlBlob(part.modelJscad)
    openForDownload(blob, {
      fileName: `${projectName}-${sanitizeFileName(part.name)}.stl`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    toast.error(`Failed to export enclosure part: ${message}`)
  }
}

/** Download all enclosure parts as a single .zip of binary STL files. */
export const exportAllEnclosureStls = async ({
  circuitJson,
  projectName,
}: {
  circuitJson: CircuitJson
  projectName: string
}) => {
  const parts = getEnclosureParts(circuitJson)
  if (parts.length === 0) {
    toast.error("No enclosure parts to export")
    return
  }
  try {
    const zip = new JSZip()
    for (const part of parts) {
      const blob = modelJscadToStlBlob(part.modelJscad)
      zip.file(`${sanitizeFileName(part.name)}.stl`, await blob.arrayBuffer())
    }
    const zipBlob = await zip.generateAsync({ type: "blob" })
    openForDownload(zipBlob, {
      fileName: `${projectName}-enclosure.zip`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    toast.error(`Failed to export enclosure parts: ${message}`)
  }
}
