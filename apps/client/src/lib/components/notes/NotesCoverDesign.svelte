<script lang="ts">
  import { getEventColor } from "$lib/components/calendar/utils";
  import type { NotesCoverColor, NotesCoverDesign } from "$lib/notes/contracts/assets";
  import { notesCoverDesignBackground } from "$lib/notes/page-cover";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { resolveAppTokens } from "$lib/stores/themes";

  let { pattern, color }: { pattern: NotesCoverDesign; color: NotesCoverColor } = $props();
  const id = $props.id();
  const theme = getTheme();
  const ink = $derived(color === "default" ? resolveAppTokens(theme.current)["--foreground"] : getEventColor(color, theme.current).bg);
  const illustrated = $derived(pattern === "contours" || pattern === "ribbons" || pattern === "landscape" || pattern === "orbit");
</script>

<div
  class="size-full overflow-hidden"
  style={`background: ${notesCoverDesignBackground(pattern, ink)}; --cover-color: ${ink}; --cover-light: color-mix(in srgb, ${ink} 22%, var(--background)); --cover-mid: color-mix(in srgb, ${ink} 58%, var(--background)); --cover-deep: color-mix(in srgb, ${ink} 65%, var(--foreground)); --cover-highlight: color-mix(in srgb, ${ink} 12%, white);`}
>
  {#if illustrated}
    <svg class="size-full" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-silk`} x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="var(--cover-highlight)" />
          <stop offset="0.42" stop-color="var(--cover-mid)" />
          <stop offset="1" stop-color="var(--cover-deep)" />
        </linearGradient>
        <linearGradient id={`${id}-haze`} x1="0" y1="0" x2="0" y2="1">
          <stop stop-color="var(--cover-highlight)" stop-opacity="0.85" />
          <stop offset="1" stop-color="var(--cover-color)" stop-opacity="0.15" />
        </linearGradient>
        <radialGradient id={`${id}-sphere`} cx="0.3" cy="0.25" r="0.8">
          <stop stop-color="var(--cover-highlight)" />
          <stop offset="0.45" stop-color="var(--cover-mid)" />
          <stop offset="1" stop-color="var(--cover-deep)" />
        </radialGradient>
      </defs>
      {#if pattern === "contours"}
        <circle cx="990" cy="60" r="185" fill={`url(#${id}-haze)`} />
        <circle cx="990" cy="60" r="212" fill="none" stroke="var(--cover-highlight)" stroke-opacity="0.22" />
        <path d="M-80 480C160 380 175 195 410 228S745 450 945 280 1020 5 1280-80" fill="none" stroke="var(--cover-color)" stroke-opacity="0.14" stroke-width="110" />
        <g fill="none" stroke="var(--cover-highlight)" stroke-width="1.7" opacity="0.55">
          {#each [0, 1, 2, 3, 4, 5, 6, 7] as line}
            <path d="M-140 470C65 360 200 32 470 150S760 460 982 205 1150-15 1330-90" transform={`translate(${line * 24} ${line * 23})`} />
          {/each}
        </g>
        <g fill="var(--cover-highlight)" opacity="0.7">
          <circle cx="725" cy="72" r="3" /><circle cx="735" cy="72" r="1.5" /><circle cx="725" cy="82" r="1.5" />
        </g>
      {:else if pattern === "ribbons"}
        <path d="M-100 220C120 520 325-165 615 45S965 520 1330 140L1330 490H-100Z" fill={`url(#${id}-silk)`} />
        <path d="M-100 320C190 555 335-120 660 160S970 465 1320 235L1320 490H-100Z" fill="var(--cover-color)" opacity="0.65" />
        <path d="M-100 390C155 525 465 85 745 245S1065 385 1320 290L1320 490H-100Z" fill="var(--cover-deep)" opacity="0.68" />
        <g fill="none" stroke="var(--cover-highlight)" stroke-width="1.4" opacity="0.5">
          <path d="M-100 220C120 520 325-165 615 45S965 520 1330 140" />
          <path d="M-100 231C120 531 325-154 615 56S965 531 1330 151" />
          <path d="M-100 390C155 525 465 85 745 245S1065 385 1320 290" />
        </g>
      {:else if pattern === "landscape"}
        <circle cx="810" cy="111" r="77" fill={`url(#${id}-haze)`} />
        <circle cx="810" cy="111" r="96" fill="none" stroke="var(--cover-highlight)" stroke-opacity="0.25" />
        <path d="M-60 315Q80 275 205 195T445 260Q550 155 675 210T930 190Q1070 115 1260 230V460H-60Z" fill="var(--cover-mid)" opacity="0.45" />
        <path d="M-80 320Q130 180 330 278T670 282Q840 180 1050 265T1280 240V460H-80Z" fill={`url(#${id}-silk)`} />
        <path d="M-70 375Q155 267 382 350T785 325Q1030 220 1270 345V450H-70Z" fill="var(--cover-deep)" opacity="0.85" />
        <path d="M-80 319Q130 179 330 277T670 281Q840 179 1050 264T1280 239" fill="none" stroke="var(--cover-highlight)" stroke-opacity="0.55" stroke-width="1.5" />
        <path d="M90 101Q240 80 385 102M975 75H1080M1040 85H1130" fill="none" stroke="var(--cover-highlight)" stroke-opacity="0.55" stroke-linecap="round" />
      {:else if pattern === "orbit"}
        <g transform="translate(800 205) rotate(-24)" fill="none" stroke="var(--cover-mid)">
          <ellipse rx="340" ry="136" opacity="0.3" /><ellipse rx="294" ry="112" opacity="0.55" /><ellipse rx="250" ry="88" />
        </g>
        <circle cx="810" cy="190" r="123" fill={`url(#${id}-sphere)`} />
        <path d="M490 300C610 365 1045 177 1095 80" fill="none" stroke="var(--cover-highlight)" stroke-width="2" opacity="0.65" />
        <circle cx="570" cy="292" r="20" fill={`url(#${id}-sphere)`} />
        <circle cx="1030" cy="95" r="8" fill="var(--cover-color)" />
        <g stroke="var(--cover-mid)" stroke-width="1.3" fill="none">
          <path d="M205 108H229M217 96V120M330 279H344M337 272V286" />
          <circle cx="380" cy="139" r="3" /><circle cx="1050" cy="318" r="3" />
          <path d="M140 329H264" stroke-dasharray="1 9" />
        </g>
      {/if}
    </svg>
  {/if}
</div>
