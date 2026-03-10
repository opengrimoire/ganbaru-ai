<script lang="ts">
  import * as d3 from "d3";
  import { onMount } from "svelte";

  interface Branch {
    id: string;
    name: string;
    color: string;
  }

  interface SkillNode {
    id: string;
    name: string;
    branchId: string;
    level: number;
    currentXp: number;
    requiredXp: number;
    unlocked: boolean;
    nodeType: "branch" | "basic" | "notable" | "keystone";
    color?: string;
  }

  interface GraphLink {
    source: string;
    target: string;
  }

  // Sample data for Phase 1
  const branches: Branch[] = [
    { id: "programming", name: "Programming", color: "#818cf8" },
    { id: "health", name: "Health", color: "#4ade80" },
    { id: "creativity", name: "Creativity", color: "#fb923c" },
    { id: "productivity", name: "Productivity", color: "#38bdf8" },
  ];

  const skills: SkillNode[] = [
    // Programming branch
    { id: "py", name: "Python", branchId: "programming", level: 2, currentXp: 80, requiredXp: 100, unlocked: true, nodeType: "basic" },
    { id: "ts", name: "TypeScript", branchId: "programming", level: 3, currentXp: 120, requiredXp: 150, unlocked: true, nodeType: "notable" },
    { id: "rust", name: "Rust", branchId: "programming", level: 1, currentXp: 20, requiredXp: 200, unlocked: false, nodeType: "keystone" },
    { id: "sql", name: "SQL", branchId: "programming", level: 2, currentXp: 60, requiredXp: 100, unlocked: true, nodeType: "basic" },
    // Health branch
    { id: "exercise", name: "Exercise", branchId: "health", level: 4, currentXp: 200, requiredXp: 250, unlocked: true, nodeType: "notable" },
    { id: "sleep", name: "Sleep discipline", branchId: "health", level: 2, currentXp: 40, requiredXp: 100, unlocked: true, nodeType: "basic" },
    { id: "nutrition", name: "Nutrition", branchId: "health", level: 1, currentXp: 10, requiredXp: 100, unlocked: false, nodeType: "basic" },
    // Creativity branch
    { id: "drawing", name: "Drawing", branchId: "creativity", level: 2, currentXp: 90, requiredXp: 150, unlocked: true, nodeType: "basic" },
    { id: "music", name: "Music theory", branchId: "creativity", level: 1, currentXp: 30, requiredXp: 100, unlocked: false, nodeType: "basic" },
    // Productivity branch
    { id: "focus", name: "Deep focus", branchId: "productivity", level: 5, currentXp: 300, requiredXp: 300, unlocked: true, nodeType: "keystone" },
    { id: "planning", name: "Planning", branchId: "productivity", level: 3, currentXp: 150, requiredXp: 150, unlocked: true, nodeType: "notable" },
    { id: "writing", name: "Writing", branchId: "productivity", level: 2, currentXp: 60, requiredXp: 100, unlocked: true, nodeType: "basic" },
  ];

  const links: GraphLink[] = [
    { source: "programming", target: "py" },
    { source: "programming", target: "ts" },
    { source: "py", target: "rust" },
    { source: "py", target: "sql" },
    { source: "health", target: "exercise" },
    { source: "health", target: "sleep" },
    { source: "sleep", target: "nutrition" },
    { source: "creativity", target: "drawing" },
    { source: "creativity", target: "music" },
    { source: "productivity", target: "focus" },
    { source: "productivity", target: "planning" },
    { source: "planning", target: "writing" },
  ];

  // Combine branch nodes and skill nodes for D3
  type GraphNode = (Branch & { nodeType: "branch"; x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null }) | (SkillNode & { x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null });

  let svgEl: SVGSVGElement | undefined = $state(undefined);
  let selectedNode: GraphNode | null = $state(null);
  let containerEl: HTMLDivElement | undefined = $state(undefined);

  function nodeRadius(node: GraphNode): number {
    if (node.nodeType === "branch") return 20;
    if (node.nodeType === "keystone") return 14;
    if (node.nodeType === "notable") return 11;
    return 8;
  }

  function nodeColor(node: GraphNode): string {
    if (node.nodeType === "branch") {
      return (node as Branch).color;
    }
    const branch = branches.find((b) => b.id === (node as SkillNode).branchId);
    const base = branch?.color ?? "#888";
    return (node as SkillNode).unlocked ? base : "#3a3a3a";
  }

  function nodeStroke(node: GraphNode): string {
    if (node.nodeType === "branch") return (node as Branch).color;
    const branch = branches.find((b) => b.id === (node as SkillNode).branchId);
    return branch?.color ?? "#888";
  }

  onMount(() => {
    if (!svgEl || !containerEl) return;

    const { width, height } = containerEl.getBoundingClientRect();

    const graphNodes: GraphNode[] = [
      ...branches.map((b) => ({ ...b, nodeType: "branch" as const })),
      ...skills,
    ];

    const svg = d3.select(svgEl).attr("width", width).attr("height", height);

    // Zoom behavior
    const g = svg.append("g");
    svg.call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 3])
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
        }),
    );

    // Links
    const linkSel = g
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#2a2a2a")
      .attr("stroke-width", 1.5);

    // Nodes
    const nodeSel = g
      .append("g")
      .selectAll<SVGGElement, GraphNode>("g")
      .data(graphNodes)
      .join("g")
      .style("cursor", "pointer")
      .on("click", (_event, d) => {
        selectedNode = d;
      });

    nodeSel
      .append("circle")
      .attr("r", nodeRadius)
      .attr("fill", nodeColor)
      .attr("stroke", nodeStroke)
      .attr("stroke-width", (d) => (d.nodeType === "branch" ? 2.5 : 1.5))
      .attr("opacity", (d) =>
        d.nodeType !== "branch" && !(d as SkillNode).unlocked ? 0.35 : 1,
      );

    // XP progress arc for skill nodes
    nodeSel
      .filter((d) => d.nodeType !== "branch")
      .append("circle")
      .attr("r", nodeRadius)
      .attr("fill", "none")
      .attr("stroke", nodeStroke)
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", (d) => {
        const n = d as SkillNode;
        const r = nodeRadius(d);
        const circ = 2 * Math.PI * r;
        const pct = Math.min(n.currentXp / n.requiredXp, 1);
        return `${circ * pct} ${circ}`;
      })
      .attr("stroke-dashoffset", (d) => {
        const r = nodeRadius(d);
        const circ = 2 * Math.PI * r;
        return circ * 0.25; // rotate to start at top
      })
      .attr("opacity", 0.6)
      .attr("transform", "rotate(-90)");

    // Labels
    nodeSel
      .append("text")
      .text((d) => d.name)
      .attr("text-anchor", "middle")
      .attr("dy", (d) => nodeRadius(d) + 13)
      .attr("font-size", (d) => (d.nodeType === "branch" ? 11 : 9))
      .attr("fill", "#a0a0a0")
      .attr("font-family", "sans-serif")
      .attr("pointer-events", "none");

    // Drag behavior
    nodeSel.call(
      d3
        .drag<SVGGElement, GraphNode>()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    );

    // Force simulation
    const simulation = d3
      .forceSimulation<GraphNode>(graphNodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, d3.SimulationLinkDatum<GraphNode>>(links as d3.SimulationLinkDatum<GraphNode>[])
          .id((d) => (d as { id: string }).id)
          .distance((l) => {
            const s = l.source as GraphNode;
            return s.nodeType === "branch" ? 100 : 70;
          }),
      )
      .force("charge", d3.forceManyBody().strength(-250))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<GraphNode>().radius((d) => nodeRadius(d) + 18))
      .on("tick", () => {
        linkSel
          .attr("x1", (d) => (d.source as unknown as GraphNode).x ?? 0)
          .attr("y1", (d) => (d.source as unknown as GraphNode).y ?? 0)
          .attr("x2", (d) => (d.target as unknown as GraphNode).x ?? 0)
          .attr("y2", (d) => (d.target as unknown as GraphNode).y ?? 0);

        nodeSel.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      });

    return () => simulation.stop();
  });
</script>

<div class="relative flex h-full flex-col overflow-hidden" bind:this={containerEl}>
  <svg bind:this={svgEl} class="h-full w-full"></svg>

  <!-- Node detail panel -->
  {#if selectedNode}
    <div class="absolute bottom-4 right-4 w-64 rounded-lg border border-border bg-card p-4 shadow-lg">
      <div class="mb-2 flex items-start justify-between">
        <div>
          <p class="text-sm font-semibold">{selectedNode.name}</p>
          <p class="text-xs text-muted-foreground capitalize">{selectedNode.nodeType}</p>
        </div>
        <button
          onclick={() => (selectedNode = null)}
          class="text-xs text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>

      {#if selectedNode.nodeType !== "branch"}
        {@const skill = selectedNode as SkillNode}
        <div class="mt-3 space-y-1">
          <div class="flex justify-between text-xs text-muted-foreground">
            <span>Level {skill.level}</span>
            <span>{skill.currentXp} / {skill.requiredXp} XP</span>
          </div>
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              class="h-full rounded-full"
              style="width: {Math.min((skill.currentXp / skill.requiredXp) * 100, 100)}%; background-color: {nodeColor(selectedNode)}"
            ></div>
          </div>
          <p class="pt-1 text-xs text-muted-foreground">
            {skill.unlocked ? "Unlocked" : "Locked — earn more XP to unlock"}
          </p>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Legend -->
  <div class="absolute bottom-4 left-4 flex gap-3">
    {#each branches as branch}
      <div class="flex items-center gap-1.5">
        <span class="h-2.5 w-2.5 rounded-full" style="background-color: {branch.color}"></span>
        <span class="text-xs text-muted-foreground">{branch.name}</span>
      </div>
    {/each}
  </div>
</div>
