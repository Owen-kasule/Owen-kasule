const fs = require("fs");
const https = require("https");
const { execFileSync } = require("child_process");

const username = process.env.GITHUB_REPOSITORY_OWNER || "Owen-kasule";
const token = process.env.GITHUB_TOKEN || getGhToken();
const animationDuration = "180000ms";
const snakeStartIndex = 3;

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

const contributionCalendarQuery = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
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

function getContributionWindows(createdAt, endDate) {
  const windows = [];
  let from = new Date(createdAt);
  from.setUTCHours(0, 0, 0, 0);

  while (from < endDate) {
    const to = new Date(from);
    to.setUTCFullYear(to.getUTCFullYear() + 1);
    if (to > endDate) to.setTime(endDate.getTime());

    windows.push({ from: from.toISOString(), to: to.toISOString() });
    from = to;
  }

  return windows;
}

async function getAllTimeContributionDays(createdAt) {
  const windows = getContributionWindows(createdAt, new Date());
  const collections = await Promise.all(
    windows.map((window) => requestGraphql(contributionCalendarQuery, { login: username, ...window }))
  );
  const uniqueDays = new Map();

  collections.forEach((collection) => {
    const weeks = collection.user.contributionsCollection.contributionCalendar.weeks;
    weeks.flatMap((week) => week.contributionDays).forEach((day) => {
      uniqueDays.set(day.date, day);
    });
  });

  return Array.from(uniqueDays.values()).sort((a, b) => a.date.localeCompare(b.date));
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

function formatFullDay(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatRange(start, end) {
  if (!start || !end) return "No active streak";
  return `${formatDay(start)} - ${formatDay(end)}`;
}

function getStats(days) {
  const total = days.reduce((sum, day) => sum + day.contributionCount, 0);
  const firstActiveDay = days.find((day) => day.contributionCount > 0);
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
    firstDate: firstActiveDay?.date,
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

function coordinateKey(point) {
  return `${point.x}:${point.y}`;
}

function isBoardCell(point, boardWidth, boardHeight) {
  return point.x >= 0 && point.x < boardWidth && point.y >= 0 && point.y < boardHeight;
}

function findSafeRoute(start, goal, activeBody, blocked, boardWidth, boardHeight, routeMargin) {
  const minX = -1;
  const maxX = boardWidth;
  const minY = -2;
  const maxY = boardHeight + 1;
  const occupied = new Set(activeBody.map(coordinateKey));
  const queue = [{ ...start }];
  const previous = new Map([[coordinateKey(start), null]]);
  const startKey = coordinateKey(start);
  const goalKey = coordinateKey(goal);
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (coordinateKey(current) === goalKey) {
      break;
    }

    directions.forEach((direction) => {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      const key = coordinateKey(next);
      const tailKey = coordinateKey(activeBody[0]);
      const walkable = key === startKey
        || key === goalKey
        || ((!occupied.has(key) || key === tailKey) && (!isBoardCell(next, boardWidth, boardHeight) || !blocked.has(key)));

      if (next.x < minX || next.x > maxX || next.y < minY || next.y > maxY || previous.has(key) || !walkable) return;
      previous.set(key, current);
      queue.push(next);
    });
  }

  if (!previous.has(goalKey)) return null;

  const route = [];
  let current = goal;
  while (current) {
    route.unshift(current);
    current = previous.get(coordinateKey(current));
  }
  return route;
}

function routeCrossesActiveBody(route, activeBody) {
  const body = activeBody.map((point) => ({ ...point }));
  return route.slice(1).some((point) => {
    const tail = body.shift();
    const crossesBody = body.some((bodyPoint) => coordinateKey(bodyPoint) === coordinateKey(point));
    body.push({ ...point });
    return crossesBody && coordinateKey(tail) !== coordinateKey(point);
  });
}

function bodyAfterRoute(route, activeBody) {
  const body = activeBody.map((point) => ({ ...point }));
  route.slice(1).forEach((point) => {
    body.shift();
    body.push({ ...point });
  });
  return body;
}

function hasSafeExit(route, activeBody, blocked, boardWidth, boardHeight) {
  const body = bodyAfterRoute(route, activeBody);
  const head = body[body.length - 1];
  const tailKey = coordinateKey(body[0]);
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];

  return directions.some((direction) => {
    const next = { x: head.x + direction.x, y: head.y + direction.y };
    const key = coordinateKey(next);
    const clearOfBody = !body.some((bodyPoint) => coordinateKey(bodyPoint) === key) || key === tailKey;
    return next.x >= -1 && next.x <= boardWidth && next.y >= -2 && next.y <= boardHeight + 1
      && clearOfBody && (!isBoardCell(next, boardWidth, boardHeight) || !blocked.has(key));
  });
}

function buildSnakePath(targets, left, top, step, boardWidth, boardHeight) {
  const start = { x: 3, y: -1 };
  const path = [0, 1, 2, 3].map((x) => ({ x: left + x * step, y: top - step }));
  const blocked = new Set(targets.map((target) => coordinateKey({ x: target.weekIndex, y: target.weekday })));
  const activeBody = [0, 1, 2, 3].map((x) => ({ x, y: -1 }));
  const remaining = targets.slice();
  let current = start;
  const routeMargin = targets.length;

  while (remaining.length) {
    let chosenIndex = -1;
    let chosenRoute = null;
    const reachableCandidates = [];

    // Prefer light colors, but let a much shorter route win to avoid dead ends.
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const goal = { x: candidate.weekIndex, y: candidate.weekday };
      const goalKey = coordinateKey(goal);
      blocked.delete(goalKey);
      const route = findSafeRoute(current, goal, activeBody, blocked, boardWidth, boardHeight, routeMargin);
      blocked.add(goalKey);

      if (route) {
        const nextBlocked = new Set(blocked);
        nextBlocked.delete(goalKey);
        if (routeCrossesActiveBody(route, activeBody) || !hasSafeExit(route, activeBody, nextBlocked, boardWidth, boardHeight)) continue;
        reachableCandidates.push({ index, route, goal, score: route.length + candidate.level * 8 });
      }
    }

    reachableCandidates.sort((first, second) => first.score - second.score || first.route.length - second.route.length);
    if (reachableCandidates.length) {
      chosenIndex = reachableCandidates[0].index;
      chosenRoute = reachableCandidates[0].route;
    }

    if (chosenIndex === -1 || !chosenRoute) {
      throw new Error(`No safe route remains for the contribution snake (${remaining.length} targets left at ${current.x}:${current.y})`);
    }

    const target = remaining.splice(chosenIndex, 1)[0];
    const goal = { x: target.weekIndex, y: target.weekday };
    blocked.delete(coordinateKey(goal));

    if (chosenRoute.some((point) => blocked.has(coordinateKey(point)))) {
      throw new Error("Snake route crossed a future green contribution cell");
    }
    chosenRoute.slice(1).forEach((point) => {
      path.push({ x: left + point.x * step, y: top + point.y * step });
      activeBody.push({ ...point });
      while (activeBody.length > 4) activeBody.shift();
    });

    target.pathIndex = path.length - 1;
    current = goal;
  }

  return path;
}

function snakeMotion(path, lag) {
  const values = path.slice(snakeStartIndex).map((_, index) => {
    const point = path[Math.max(0, snakeStartIndex + index - lag)];
    return `${point.x} ${point.y}`;
  }).join(";");

  return `<animateTransform attributeName="transform" type="translate" dur="${animationDuration}" repeatCount="indefinite" calcMode="discrete" values="${values}" />`;
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

function polarToCartesian(cx, cy, radius, angleDegrees) {
  const angleRadians = angleDegrees * Math.PI / 180;
  return {
    x: cx + radius * Math.cos(angleRadians),
    y: cy + radius * Math.sin(angleRadians),
  };
}

function describeArc(cx, cy, radius, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, radius, startAngle);
  const end = polarToCartesian(cx, cy, radius, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;

  return [
    `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
  ].join(" ");
}

function renderStatsCard(stats) {
  const width = 990;
  const height = 390;
  const bg = "#111111";
  const text = "#ffffff";
  const muted = "#a5a5a5";
  const accent = "#C2FFC7";
  const purple = "#CB9DF0";
  const ringRadius = 78;
  const progress = Math.min(0.96, Math.max(0.16, stats.current / Math.max(1, stats.longest)));
  const ringArc = describeArc(495, 140, ringRadius, -50, 230);
  const dash = `${(progress * 100).toFixed(1)} 100`;

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${username} GitHub stats</title>
  <desc id="desc">GitHub contribution totals, current streak, and longest streak for ${username}.</desc>
  <style>
    .number { font: 800 56px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${text}; }
    .middle-number { font: 800 52px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${text}; }
    .label { font: 700 27px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${text}; }
    .muted { font: 700 23px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${muted}; }
    .green { fill: ${accent}; }
  </style>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="8" fill="${bg}" stroke="#d7d7d7" stroke-width="2" />
  <line x1="330" y1="62" x2="330" y2="328" stroke="#d7d7d7" stroke-width="2" />
  <line x1="660" y1="62" x2="660" y2="328" stroke="#d7d7d7" stroke-width="2" />

  <text class="number" x="165" y="170" text-anchor="middle">${formatNumber(stats.total)}</text>
  <text class="label" x="165" y="236" text-anchor="middle">Total Contributions</text>
  <text class="muted" x="165" y="300" text-anchor="middle">${formatFullDay(stats.firstDate)} - Present</text>

  <path d="${ringArc}" pathLength="100" stroke="${accent}" stroke-width="10" stroke-linecap="round" opacity="0.25" />
  <path d="${ringArc}" pathLength="100" stroke="${accent}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${dash}" />
  <path d="M495 43 C511 59 516 74 505 86 C496 97 476 92 480 74 C481 66 488 62 492 53 C495 62 506 69 500 78 C509 69 504 54 495 43Z" fill="${purple}" />
  <text class="middle-number" x="495" y="164" text-anchor="middle">${stats.current}</text>
  <text class="label green" x="495" y="280" text-anchor="middle">Current Streak</text>
  <text class="muted" x="495" y="330" text-anchor="middle">${formatRange(stats.currentStart, stats.currentEnd)}</text>

  <text class="number" x="825" y="170" text-anchor="middle">${stats.longest}</text>
  <text class="label" x="825" y="236" text-anchor="middle">Longest Streak</text>
  <text class="muted" x="825" y="300" text-anchor="middle">${formatRange(stats.longestStart, stats.longestEnd)}</text>
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
  const stroke = dark ? "#263341" : "#d0d7de";
  const emptyFill = dark ? "#f0f3f6" : "#ebedf0";
  const paddle = "#9BE9A8";
  const snakeColors = ["#f0b6ff", "#d58aff", "#b866f2", "#9844c7"];
  const cells = [];
  const targets = [];

  weeks.forEach((week, weekIndex) => {
    week.contributionDays.forEach((day) => {
      const x = left + weekIndex * step;
      const y = top + day.weekday * step;
      const fill = contributionColor(day.contributionCount, dark);
      const target = { ...day, weekIndex, x, y, level: contributionLevel(day.contributionCount) };

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

  const path = buildSnakePath(targets, left, top, step, weeks.length, 7);
  const targetPositions = new Map(targets.map((target) => [`${target.x}:${target.y}`, target]));
  path.forEach((point, pathIndex) => {
    const target = targetPositions.get(`${point.x}:${point.y}`);
    if (target && target.passIndex === undefined) {
      target.passIndex = pathIndex;
    }
  });

  targets.forEach((target) => {
    target.eatIndex = target.passIndex ?? target.pathIndex;
    target.eatProgress = (target.eatIndex - snakeStartIndex) / Math.max(1, path.length - snakeStartIndex - 1);
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
    { size: step, offset: 0, color: snakeColors[0], lag: 0, opacity: 1 },
    { size: step, offset: 0, color: snakeColors[1], lag: 1, opacity: 0.98 },
    { size: step, offset: 0, color: snakeColors[2], lag: 2, opacity: 0.96 },
    { size: step, offset: 0, color: snakeColors[3], lag: 3, opacity: 0.94 },
  ].map((segment) => `<rect x="${segment.offset}" y="${segment.offset}" width="${segment.size}" height="${segment.size}" fill="${segment.color}" opacity="${segment.opacity}">${snakeMotion(path, segment.lag)}</rect>`).join("\n");
  const eatenTargets = targets.slice().sort((a, b) => a.eatIndex - b.eatIndex);

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${username} brick-game contribution snake</title>
  <desc id="desc">A blocky arcade-style snake eats the lightest green contribution bricks first, leaving a clean white path until the board is cleared.</desc>
  <style>
    .title { font: 700 28px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${text}; }
    .quote { font: 700 16px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${text}; }
    .author { font: 600 13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; fill: ${paddle}; letter-spacing: 1px; }
  </style>
  <rect width="100%" height="100%" rx="12" fill="${bg}" />
  <text class="title" x="${width / 2}" y="38" text-anchor="middle">Contribution Snake</text>
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
        createdAt
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
  const allTimeDays = await getAllTimeContributionDays(data.user.createdAt);
  const stats = getStats(allTimeDays);
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
