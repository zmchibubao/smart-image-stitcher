import type { MatchResult, StitchGroup, ImageItem } from '../types'

interface DirectedEdge {
  from: string
  to: string
  score: number
  overlapH: number
  dx: number
  match: MatchResult
}

/**
 * 全局最优路径阅读顺序与分组求解器：
 * 采用有向无环最长链搜索算法，最大化将具有上下重叠关系的图片连接在同一链条中，
 * 彻底防止过度拆分（如将 7 张图拆为 3 组的问题），同时尊重用户锁定的位置。
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

  // 1. 整理所有候选有向边
  const edges: DirectedEdge[] = []
  for (const match of matches) {
    if (match.score < 0.38 || match.confidence === 'none') continue
    if (!idSet.has(match.imageIdA) || !idSet.has(match.imageIdB)) continue

    if (match.direction === 'A_before_B') {
      edges.push({
        from: match.imageIdA,
        to: match.imageIdB,
        score: match.score,
        overlapH: match.overlapHeightA,
        dx: match.offsetX,
        match,
      })
    } else if (match.direction === 'B_before_A') {
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
      edges.push({
        from: match.imageIdB,
        to: match.imageIdA,
        score: match.score,
        overlapH: match.overlapHeightB,
        dx: -match.offsetX,
        match: reversed,
      })
    }
  }

  // 过滤与用户锁定位置冲突的边
  const validEdges = edges.filter(e => {
    if (!lockedPositions) return true
    const fromLock = lockedPositions.get(e.from)
    const toLock = lockedPositions.get(e.to)
    if (fromLock !== undefined && toLock !== undefined && fromLock >= toLock) {
      return false
    }
    return true
  })

  // 2. 构建邻接表
  const adj = new Map<string, DirectedEdge[]>()
  for (const img of images) {
    adj.set(img.id, [])
  }
  for (const edge of validEdges) {
    adj.get(edge.from)?.push(edge)
  }

  // 3. 递归/动态规划搜索最长权重路径（覆盖最多节点优先，其次得分最高）
  const allIds = images.map(i => i.id)
  const remainingIds = new Set(allIds)
  const groups: StitchGroup[] = []
  let groupId = 0

  while (remainingIds.size > 0) {
    let bestChain: string[] = []
    let bestScore = -Infinity

    function dfs(
      currId: string,
      visited: Set<string>,
      path: string[],
      score: number
    ) {
      if (
        path.length > bestChain.length ||
        (path.length === bestChain.length && score > bestScore)
      ) {
        bestChain = [...path]
        bestScore = score
      }

      const neighbors = adj.get(currId) || []
      for (const edge of neighbors) {
        if (remainingIds.has(edge.to) && !visited.has(edge.to)) {
          // 边权重 = 匹配置信度得分 * 重叠高度因子（重叠行数越多，证据越确凿，防止 1 行文本的短重叠截断长链路）
          const overlapFactor = Math.min(1.2, Math.max(0.3, edge.overlapH / 100))
          const edgeWeight = edge.score * overlapFactor

          visited.add(edge.to)
          path.push(edge.to)
          dfs(edge.to, visited, path, score + edgeWeight)
          path.pop()
          visited.delete(edge.to)
        }
      }
    }

    for (const startId of remainingIds) {
      const visited = new Set([startId])
      dfs(startId, visited, [startId], 0)
    }

    if (bestChain.length === 0) {
      // 兜底：取剩余的第一个独立图片
      const firstRem = Array.from(remainingIds)[0]
      bestChain = [firstRem]
    }

    // 移除已分配给当前组的节点
    for (const id of bestChain) {
      remainingIds.delete(id)
    }

    // 收集该组使用的匹配结果
    const groupMatches: MatchResult[] = []
    for (let i = 0; i < bestChain.length - 1; i++) {
      const u = bestChain[i]
      const v = bestChain[i + 1]
      const edge = validEdges.find(e => e.from === u && e.to === v)
      if (edge) groupMatches.push(edge.match)
    }

    groups.push({
      id: groupId++,
      imageIds: bestChain,
      matches: groupMatches,
    })
  }

  // 按组内包含的图片数量降序排列（主拼接组排最前）
  groups.sort((a, b) => b.imageIds.length - a.imageIds.length)

  return groups
}

/**
 * 精确检测完全重复图片与近重复草稿截图
 */
export function detectDuplicates(
  images: ImageItem[],
  matches: MatchResult[]
): Set<string> {
  const duplicates = new Set<string>()

  // 计算每张图片的有效墨迹密度（手写笔记与文字量）
  const inkMap = new Map<string, number>()
  for (const img of images) {
    if (img.canvasFeature) {
      let sum = 0
      for (let i = 0; i < img.canvasFeature.ink.length; i++) {
        sum += img.canvasFeature.ink[i]
      }
      inkMap.set(img.id, sum)
    }
  }

  for (const m of matches) {
    // 1. 完全相同图片 (score > 0.95 且位移接近 0)
    if (m.score > 0.95 && Math.abs(m.offsetX) < 4 && Math.abs(m.offsetY) < 4) {
      duplicates.add(m.imageIdB)
    }
    // 2. 同一屏增量草稿截图 (重叠率超 80%，位移极小，内容相似)
    else if (
      m.score >= 0.70 &&
      (m.overlapHeightA > 450 || m.overlapHeightB > 450) &&
      Math.abs(m.offsetY) < 35
    ) {
      const inkA = inkMap.get(m.imageIdA) || 0
      const inkB = inkMap.get(m.imageIdB) || 0
      // 保留板书笔记更丰富的一张，去除草稿未批注的一张
      if (inkA < inkB) {
        duplicates.add(m.imageIdA)
      } else {
        duplicates.add(m.imageIdB)
      }
    }
  }

  return duplicates
}
