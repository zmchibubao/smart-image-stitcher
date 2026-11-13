import type { MatchResult, StitchGroup, ImageItem } from '../types'

interface Edge {
  from: string
  to: string
  score: number
  match: MatchResult
}

/**
 * Given all images and their pairwise match results,
 * determine the correct linear order and group independent chains.
 */
export function solveOrder(
  images: ImageItem[],
  matches: MatchResult[],
  lockedPositions?: Map<string, number>
): StitchGroup[] {
  if (images.length === 0) return []
  if (images.length === 1) {
    return [{ id: 0, imageIds: [images[0].id], matches: [] }]
  }

  const idSet = new Set(images.map(i => i.id))

  // Build directed edges from matches
  const edges: Edge[] = []
  for (const match of matches) {
    if (match.score < 0.1 || match.confidence === 'none') continue
    if (!idSet.has(match.imageIdA) || !idSet.has(match.imageIdB)) continue

    if (match.direction === 'A_before_B') {
      edges.push({ from: match.imageIdA, to: match.imageIdB, score: match.score, match })
    } else if (match.direction === 'B_before_A') {
      // Restate as B -> A
      const reversed: MatchResult = {
        ...match,
        imageIdA: match.imageIdB,
        imageIdB: match.imageIdA,
        offsetX: -match.offsetX,
        offsetY: -match.offsetY,
        overlapHeightA: match.overlapHeightB,
        overlapHeightB: match.overlapHeightA,
        direction: 'A_before_B',
      }
      edges.push({ from: match.imageIdB, to: match.imageIdA, score: match.score, match: reversed })
    }
  }

  // Union-Find for connected components
  const parent: Record<string, string> = {}
  const rank: Record<string, number> = {}
  for (const img of images) {
    parent[img.id] = img.id
    rank[img.id] = 0
  }

  function find(x: string): string {
    if (parent[x] !== x) parent[x] = find(parent[x])
    return parent[x]
  }

  function union(x: string, y: string) {
    const px = find(x), py = find(y)
    if (px === py) return
    if (rank[px] < rank[py]) parent[px] = py
    else if (rank[px] > rank[py]) parent[py] = px
    else { parent[py] = px; rank[px]++ }
  }

  // Build chains: each node can have at most 1 predecessor and 1 successor
  const outEdge: Record<string, Edge | undefined> = {}
  const inEdge: Record<string, Edge | undefined> = {}
  const usedEdges: Edge[] = []

  // Sort by score descending - greedy but handles cycles
  const sortedEdges = [...edges].sort((a, b) => b.score - a.score)

  for (const edge of sortedEdges) {
    if (outEdge[edge.from]) continue  // from already has a successor
    if (inEdge[edge.to]) continue    // to already has a predecessor
    if (find(edge.from) === find(edge.to)) continue // would create cycle

    // Respect locked positions: locked nodes keep their relative order
    if (lockedPositions) {
      const fromLock = lockedPositions.get(edge.from)
      const toLock = lockedPositions.get(edge.to)
      if (fromLock !== undefined && toLock !== undefined && fromLock >= toLock) {
        continue // locked order conflict
      }
    }

    union(edge.from, edge.to)
    outEdge[edge.from] = edge
    inEdge[edge.to] = edge
    usedEdges.push(edge)
  }

  // Build connected components
  const components = new Map<string, string[]>()
  for (const img of images) {
    const p = find(img.id)
    if (!components.has(p)) components.set(p, [])
    components.get(p)!.push(img.id)
  }

  const groups: StitchGroup[] = []
  let groupId = 0

  for (const [, compIds] of components) {
    // Find start node (no predecessor in this component)
    const compSet = new Set(compIds)
    const startNodes = compIds.filter(id => !inEdge[id] || !compSet.has(inEdge[id]!.from))

    let startNode = startNodes[0]
    if (!startNode) startNode = compIds[0]

    // Walk chain
    const ordered: string[] = [startNode]
    const visited = new Set([startNode])
    let current = startNode

    while (outEdge[current] && compSet.has(outEdge[current]!.to)) {
      const next = outEdge[current]!.to
      if (visited.has(next)) break // cycle guard
      ordered.push(next)
      visited.add(next)
      current = next
    }

    // Add any nodes not reached
    for (const id of compIds) {
      if (!visited.has(id)) ordered.push(id)
    }

    // Gather match results for this group
    const groupMatches = usedEdges
      .filter(e => compSet.has(e.from) && compSet.has(e.to))
      .map(e => e.match)

    groups.push({ id: groupId++, imageIds: ordered, matches: groupMatches })
  }

  // Sort groups by size (largest first)
  groups.sort((a, b) => b.imageIds.length - a.imageIds.length)

  return groups
}

/**
 * Detect exact duplicate images by comparing feature counts and rough positions
 */
export function detectDuplicates(
  _images: ImageItem[],
  matches: MatchResult[]
): Set<string> {
  const duplicates = new Set<string>()

  for (const m of matches) {
    // Very high score (>0.95) with minimal offset = likely duplicate
    if (m.score > 0.95 && Math.abs(m.offsetX) < 5 && Math.abs(m.offsetY) < 5) {
      // Mark the second one as duplicate
      duplicates.add(m.imageIdB)
    }
  }

  return duplicates
}
