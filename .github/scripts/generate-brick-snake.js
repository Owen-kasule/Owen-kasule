const fs = require("fs");
const https = require("https");
const { execFileSync } = require("child_process");

const username = process.env.GITHUB_REPOSITORY_OWNER || "Owen-kasule";
const token = process.env.GITHUB_TOKEN || getGhToken();
const animationDuration = "70500ms";

function getGhToken() {
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function requestGraphql(query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: "api.github.com",
      path: "/graphql",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "User-Agent": `${username}-profile-readme`,
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GitHub API returned ${res.statusCode}: ${data}`));
          return;
        }

        const parsed = JSON.parse(data);
        if (parsed.errors) {
          reject(new Error(JSON.stringify(parsed.errors)));
          return;
        }

        resolve(parsed.data);
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function contributionLevel(count) {
  if (count === 0) return 0;
  if (count < 5) return 1;
  if (count < 15) return 2;
  if (count < 30) return 3;
  return 4;
}

function contributionColor(count, dark) {
  if (count === 0) return dark ? "#f0f3f6" : "#ebedf0";

  const colors = dark
    ? ["#9be9a8", "#40c463", "#30a14e", "#216e39"]
    : ["#9be9a8", "#40c463", "#30a14e", "#216e39"];

  return colors[contributionLevel(count) - 1];
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDay(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatRange(start, end) {
  if (!start || !end) return "No active streak";
  return `${formatDay(start)} - ${formatDay(end)}`;
}

function getStats(days) {
  const total = days.reduce((sum, day) => sum + day.contributionCount, 0);
  let longest = 0;
  let longestStart = null;
  let longestEnd = null;
  let run = 0;
  let runStart = null;

  days.forEach((day) => {
    if (day.contributionCount > 0) {
      if (run === 0) runStart = day.date;
      run += 1;

      if (run > longest) {
        longest = run;
        longestStart = runStart;
        longestEnd = day.date;
      }
      return;
    }

    run = 0;
    runStart = null;
  });

  let current = 0;
  let currentStart = null;
  let currentEnd = null;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const day = days[index];
    if (day.contributionCount === 0) break;
    current += 1;
    currentStart = day.date;
    if (!currentEnd) currentEnd = day.date;
  }

  return {
    total,
    firstDate: days[0]?.date,
    current,
    currentStart,
    currentEnd,
    longest,
    longestStart,
    longestEnd,
  };
}

function getEatenFillAnimation(originalFill, emptyFill, progress) {
  const eatAt = Math.min(0.985, Math.max(0.002, progress));
  const turn = Math.min(0.995, eatAt + 0.003);

  return `<animate attributeName="fill" dur="${animationDuration}" repeatCount="indefinite" calcMode="discrete" keyTimes="0;${eatAt.toFixed(4)};${turn.toFixed(4)};1" values="${originalFill};${originalFill};${emptyFill};${emptyFill}" />`;
}

function addRoute(path, from, to, step) {
  const current = { ...from };

  while (current.x !== to.x || current.y !== to.y) {
    if (current.x !== to.x) {
      current.x += Math.sign(to.x - current.x) * step;
    } else {
      current.y += Math.sign(to.y - current.y) * step;
    }
    path.push({ ...current });
  }

  return current;
}

function buildSnakePath(targets, left, top, step) {
  const path = [];
  const exitY = top - 2 * step;
  let current = { x: left - 2 * step, y: exitY };

  path.push({ ...current });

  targets.forEach((target) => {
    // The top lane gives the snake room to leave the board between distant targets.
    current = addRoute(path, current, { x: target.x, y: exitY }, step);
    current = addRoute(path, current, { x: target.x, y: target.y }, step);
    target.pathIndex = path.length - 1;
  });

  return path;
}

function compressPath(path) {
  const waypointIndices = [0];

  for (let index = 1; index < path.length - 1; index += 1) {
    const previous = path[index - 1];
    const point = path[index];
    const next = path[index + 1];
    const incoming = `${point.x - previous.x}:${point.y - previous.y}`;
    const outgoing = `${next.x - point.x}:${next.y - point.y}`;

    if (incoming !== outgoing) {
      waypointIndices.push(index);
    }
  }

  waypointIndices.push(path.length - 1);
  return { waypointIndices, points: waypointIndices.map((index) => path[index]) };
}

function progressAtPathIndex(pathIndex, waypointIndices) {
  for (let index = 1; index < waypointIndices.length; index += 1) {
    const segmentStart = waypointIndices[index - 1];
    const segmentEnd = waypointIndices[index];
    if (pathIndex <= segmentEnd) {
      const withinSegment = (pathIndex - segmentStart) / Math.max(1, segmentEnd - segmentStart);
      return (index - 1 + withinSegment) / Math.max(1, waypointIndices.length - 1);
    }
  }

  return 1;
}

function snakeMotion(pathData, lag) {
  const values = pathData.waypointIndices.map((fullIndex) => {
    const point = pathData.path[Math.max(0, fullIndex - lag)];
    return `${point.x} ${point.y}`;
  }).join(";");

  return `<animateTransform attributeName="transform" type="translate" dur="${animationDuration}" repeatCount="indefinite" calcMode="linear" values="${values}" />`;
}

function renderProgressBar(targets, left, top, width, height, stroke) {
  const segmentWidth = width / Math.max(1, targets.length);
  const track = `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="2" fill="${stroke}" opacity="0.45" />`;
  const segments = targets.map((target, index) => {
    const x = left + index * segmentWidth;
    const segment = index === targets.length - 1
      ? left + width - x
      : segmentWidth;
    const eatAt = Math.min(0.985, Math.max(0.002, target.eatProgress));
    const turn = Math.min(0.995, eatAt + 0.003);

    return `<rect x="${x.toFixed(2)}" y="${top}" width="0" height="${height}" fill="${target.fill}">
      <animate attributeName="width" dur="${animationDuration}" repeatCount="indefinite" calcMode="discrete" keyTimes="0;${eatAt.toFixed(4)};${turn.toFixed(4)};1" values="0;0;${segment.toFixed(2)};${segment.toFixed(2)}" />
    </rect>`;
  }).join("\n");

  return `${track}\n${segments}`;
}

function flattenCalendar(weeks) {
  return weeks
    .flatMap((week, weekIndex) => week.contributionDays.map((day) => ({ ...day, weekIndex })))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function renderStatsCard(stats) {
  const width = 990;
  const height = 280;
  const bg = "#111111";
  const text = "#ffffff";
  const muted = "#a5a5a5";
  const accent = "#C2FFC7";
  const purple = "#CB9DF0";
  const ringRadius = 66;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const progress = Math.min(0.96, Math.max(0.16, stats.current / Math.max(1, stats.longest)));
  const dash = `${(progress * ringCircumference).toFixed(1)} ${ringCircumference.toFixed(1)}`;

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${username} GitHub stats</title>
  <desc id="desc">GitHub contribution totals, current streak, and longest streak for ${username}.</desc>
  <style>
    .number { font: 800 56px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${text}; }
    .label { font: 700 28px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${text}; }
    .muted { font: 700 24px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${muted}; }
    .green { fill: ${accent}; }
  </style>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="8" fill="${bg}" stroke="#d7d7d7" stroke-width="2" />
  <line x1="330" y1="48" x2="330" y2="232" stroke="#d7d7d7" stroke-width="2" />
  <line x1="660" y1="48" x2="660" y2="232" stroke="#d7d7d7" stroke-width="2" />

  <text class="number" x="165" y="112" text-anchor="middle">${formatNumber(stats.total)}</text>
  <text class="label" x="165" y="164" text-anchor="middle">Total Contributions</text>
  <text class="muted" x="165" y="210" text-anchor="middle">${formatDay(stats.firstDate)} - Present</text>

  <circle cx="495" cy="94" r="${ringRadius}" stroke="${accent}" stroke-width="10" opacity="0.25" />
  <circle cx="495" cy="94" r="${ringRadius}" stroke="${accent}" stroke-width="10" stroke-linecap="round" transform="rotate(-90 495 94)" stroke-dasharray="${dash}" />
  <path d="M495 32 C511 48 516 63 505 75 C496 86 476 81 480 63 C481 55 488 51 492 42 C495 51 506 58 500 67 C509 58 504 43 495 32Z" fill="${purple}" />
  <text class="number" x="495" y="119" text-anchor="middle">${stats.current}</text>
  <text class="label green" x="495" y="202" text-anchor="middle">Current Streak</text>
  <text class="muted" x="495" y="242" text-anchor="middle">${formatRange(stats.currentStart, stats.currentEnd)}</text>

  <text class="number" x="825" y="112" text-anchor="middle">${stats.longest}</text>
  <text class="label" x="825" y="164" text-anchor="middle">Longest Streak</text>
  <text class="muted" x="825" y="210" text-anchor="middle">${formatRange(stats.longestStart, stats.longestEnd)}</text>
</svg>
`;
}

function renderSnakeSvg(weeks, dark) {
  const cell = 11;
  const gap = 4;
  const step = cell + gap;
  const left = 34;
  const top = 78;
  const footerTop = top + 7 * step + 30;
  const gridWidth = weeks.length * step - gap;
  const width = left * 2 + gridWidth;
  const height = footerTop + 92;
  const bg = dark ? "#1f2933" : "#f6f8fa";
  const text = dark ? "#edf2f7" : "#1f2933";
  const muted = dark ? "#b8c2cc" : "#57606a";
  const stroke = dark ? "#263341" : "#d0d7de";
  const emptyFill = dark ? "#f0f3f6" : "#ebedf0";
  const paddle = "#9BE9A8";
  const snakeColors = ["#CB9DF0", "#a855f7", "#8a00a8", "#7a007c", "#65006d", "#4c005c"];
  const cells = [];
  const targets = [];

  weeks.forEach((week, weekIndex) => {
    week.contributionDays.forEach((day) => {
      const x = left + weekIndex * step;
      const y = top + day.weekday * step;
      const fill = contributionColor(day.contributionCount, dark);
      const target = { ...day, x, y, level: contributionLevel(day.contributionCount) };

      if (day.contributionCount > 0) {
        targets.push(target);
      }
    });
  });

  targets.sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    if (a.contributionCount !== b.contributionCount) return a.contributionCount - b.contributionCount;
    if (a.weekday !== b.weekday) return a.weekday - b.weekday;
    return b.weekIndex - a.weekIndex;
  });

  const path = buildSnakePath(targets, left, top, step);
  const pathData = { path, ...compressPath(path) };
  const targetPositions = new Map(targets.map((target) => [`${target.x}:${target.y}`, target]));
  path.forEach((point, pathIndex) => {
    const target = targetPositions.get(`${point.x}:${point.y}`);
    if (target && target.passIndex === undefined) {
      target.passIndex = pathIndex;
    }
  });

  targets.forEach((target) => {
    target.eatIndex = target.passIndex ?? target.pathIndex;
    target.eatProgress = progressAtPathIndex(target.eatIndex, pathData.waypointIndices);
    target.fill = contributionColor(target.contributionCount, dark);
  });

  const targetKeys = new Map(targets.map((target) => [`${target.date}`, target]));

  weeks.forEach((week, weekIndex) => {
    week.contributionDays.forEach((day) => {
      const x = left + weekIndex * step;
      const y = top + day.weekday * step;
      const fill = contributionColor(day.contributionCount, dark);
      const target = targetKeys.get(day.date);
      const eatAnimation = target === undefined
        ? ""
        : getEatenFillAnimation(fill, emptyFill, target.eatProgress);

      cells.push(
        `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="0.45">${eatAnimation}<title>${day.date}: ${day.contributionCount} contributions</title></rect>`
      );
    });
  });

  const snake = [
    { size: cell + 4, offset: -2, color: snakeColors[0], lag: 0, opacity: 1 },
    { size: cell + 2, offset: -1, color: snakeColors[1], lag: 3, opacity: 0.95 },
    { size: cell, offset: 0, color: snakeColors[2], lag: 6, opacity: 0.9 },
    { size: cell - 1, offset: 0.5, color: snakeColors[3], lag: 9, opacity: 0.85 },
  ].map((segment) => `<rect x="${segment.offset}" y="${segment.offset}" width="${segment.size}" height="${segment.size}" rx="3.5" fill="${segment.color}" opacity="${segment.opacity}">${snakeMotion(pathData, segment.lag)}</rect>`).join("\n");
  const eatenTargets = targets.slice().sort((a, b) => a.eatIndex - b.eatIndex);

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${username} brick-game contribution snake</title>
  <desc id="desc">A blocky arcade-style snake eats the lightest green contribution bricks first, leaving a clean white path until the board is cleared.</desc>
  <style>
    .title { font: 700 28px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${text}; }
    .label { font: 700 13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; fill: ${muted}; letter-spacing: 1px; }
    .quote { font: 700 16px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${text}; }
    .author { font: 600 13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; fill: ${paddle}; letter-spacing: 1px; }
  </style>
  <rect width="100%" height="100%" rx="12" fill="${bg}" />
  <text class="title" x="${width / 2}" y="38" text-anchor="middle">Contribution Snake</text>
  <text class="label" x="${width / 2}" y="61" text-anchor="middle">EATS LIGHT GREEN FIRST / CLEARS TO WHITE</text>
  <g>${cells.join("\n")}</g>
  <g aria-label="One continuous contribution snake">${snake}</g>
  <g aria-label="Contribution colors eaten in order">${renderProgressBar(eatenTargets, left, footerTop, gridWidth, 12, stroke)}</g>
  <rect x="${left}" y="${footerTop + 34}" width="${gridWidth}" height="1" fill="${stroke}" />
  <text class="quote" x="${width / 2}" y="${footerTop + 62}" text-anchor="middle">“The best way to predict the future is to invent it.”</text>
  <text class="author" x="${width / 2}" y="${footerTop + 84}" text-anchor="middle">ALAN KAY</text>
</svg>
`;
}

async function main() {
  if (!token) {
    throw new Error("Missing GitHub token. Set GITHUB_TOKEN or authenticate with gh.");
  }

  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
                weekday
              }
            }
          }
        }
      }
    }
  `;

  const data = await requestGraphql(query, { login: username });
  const weeks = data.user.contributionsCollection.contributionCalendar.weeks;
  const days = flattenCalendar(weeks);
  const stats = getStats(days);
  const outputDir = process.env.OUTPUT_DIR || "dist";

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(`${outputDir}/github-contribution-grid-snake.svg`, renderSnakeSvg(weeks, false));
  fs.writeFileSync(`${outputDir}/github-contribution-grid-snake-dark.svg`, renderSnakeSvg(weeks, true));
  fs.writeFileSync(`${outputDir}/github-stats-card.svg`, renderStatsCard(stats));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
