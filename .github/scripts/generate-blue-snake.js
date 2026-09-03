const fs = require("fs");
const https = require("https");

const username = process.env.GITHUB_REPOSITORY_OWNER || "Owen-kasule";
const token = process.env.GITHUB_TOKEN;
const outputDir = process.env.OUTPUT_DIR || "dist";
const animationDuration = "90000ms";

if (!token) {
  throw new Error("Missing GITHUB_TOKEN");
}

function requestGraphQL(query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });

    const req = https.request(
      {
        hostname: "api.github.com",
        path: "/graphql",
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": `${username}-profile-snake`,
        },
      },
      (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

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
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function level(count) {
  if (count === 0) return 0;
  if (count < 5) return 1;
  if (count < 15) return 2;
  if (count < 30) return 3;
  return 4;
}

function cellColor(count, dark) {
  if (count === 0) return dark ? "#10162A" : "#E2E8F0";

  const palette = dark
    ? ["#172554", "#1D4ED8", "#3B82F6", "#60A5FA"]
    : ["#DBEAFE", "#93C5FD", "#3B82F6", "#1D4ED8"];

  return palette[level(count) - 1];
}

function buildPath(weeks, left, top, step) {
  const points = [];

  points.push(
    { x: left - step * 3, y: top },
    { x: left - step * 2, y: top },
    { x: left - step, y: top },
  );

  weeks.forEach((week, weekIndex) => {
    const days = week.contributionDays;
    const indexes = [...Array(days.length).keys()];

    if (weekIndex % 2 === 1) {
      indexes.reverse();
    }

    indexes.forEach((dayIndex) => {
      points.push({
        x: left + weekIndex * step,
        y: top + dayIndex * step,
      });
    });
  });

  return points;
}

function motion(path, lag) {
  const values = path.map((_, index) => {
    const point = path[Math.max(0, index - lag)];
    return `${point.x} ${point.y}`;
  });

  return `<animateTransform attributeName="transform" type="translate" dur="${animationDuration}" repeatCount="indefinite" calcMode="discrete" values="${values.join(";")}" />`;
}

function eatenAnimation(originalFill, emptyFill, progress) {
  const eatAt = Math.min(0.995, Math.max(0.001, progress));
  const clearAt = Math.min(0.999, eatAt + 0.002);

  return `<animate attributeName="fill" dur="${animationDuration}" repeatCount="indefinite" calcMode="discrete" keyTimes="0;${eatAt.toFixed(4)};${clearAt.toFixed(4)};1" values="${originalFill};${originalFill};${emptyFill};${emptyFill}" />`;
}

function renderProgressBar(path, left, top, width, dark) {
  const track = dark ? "#06070C" : "#DBEAFE";
  const border = dark ? "#1D4ED8" : "#93C5FD";
  const barHeight = 8;

  const keyTimes = path.map((_, index) =>
    (index / Math.max(1, path.length - 1)).toFixed(4),
  );

  const widths = path.map((_, index) =>
    ((index / Math.max(1, path.length - 1)) * width).toFixed(2),
  );

  return `
  <defs>
    <linearGradient id="progress-blue" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#1D4ED8" />
      <stop offset="55%" stop-color="#3B82F6" />
      <stop offset="100%" stop-color="#60A5FA" />
    </linearGradient>
  </defs>
  <g aria-label="Snake progress">
    <rect x="${left}" y="${top}" width="${width}" height="${barHeight}" rx="4" fill="${track}" stroke="${border}" stroke-width="1" opacity="0.95" />
    <rect x="${left}" y="${top}" width="0" height="${barHeight}" rx="4" fill="url(#progress-blue)">
      <animate attributeName="width" dur="${animationDuration}" repeatCount="indefinite" calcMode="discrete" keyTimes="${keyTimes.join(";")}" values="${widths.join(";")}" />
    </rect>
  </g>`;
}

function render(weeks, dark) {
  const cell = 11;
  const gap = 4;
  const step = cell + gap;
  const left = 55;
  const top = 16;
  const gridWidth = weeks.length * step - gap;
  const gridHeight = 7 * step - gap;
  const progressTop = top + gridHeight + 15;
  const bottom = 18;
  const width = left + gridWidth + 18;
  const height = progressTop + 8 + bottom;
  const emptyFill = dark ? "#10162A" : "#E2E8F0";

  const path = buildPath(weeks, left, top, step);
  const pathIndex = new Map(path.map((point, index) => [`${point.x}:${point.y}`, index]));
  const cells = [];

  weeks.forEach((week, weekIndex) => {
    week.contributionDays.forEach((day, dayIndex) => {
      const x = left + weekIndex * step;
      const y = top + dayIndex * step;
      const fill = cellColor(day.contributionCount, dark);
      const index = pathIndex.get(`${x}:${y}`) ?? 0;
      const progress = index / Math.max(1, path.length - 1);
      const animation =
        day.contributionCount > 0
          ? eatenAnimation(fill, emptyFill, progress)
          : "";

      cells.push(
        `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2.5" fill="${fill}">${animation}<title>${day.date}: ${day.contributionCount} contributions</title></rect>`,
      );
    });
  });

  const headSize = 21;
  const bodySize = 13;
  const headOffset = (step - headSize) / 2;
  const bodyOffset = (step - bodySize) / 2;

  const body = [
    { lag: 3, color: "#1D4ED8" },
    { lag: 2, color: "#2563EB" },
    { lag: 1, color: "#3B82F6" },
  ]
    .map(
      (segment) =>
        `<rect x="${bodyOffset}" y="${bodyOffset}" width="${bodySize}" height="${bodySize}" rx="5" fill="${segment.color}">${motion(path, segment.lag)}</rect>`,
    )
    .join("\n");

  const head = `<rect x="${headOffset}" y="${headOffset}" width="${headSize}" height="${headSize}" rx="7" fill="#60A5FA">${motion(path, 0)}</rect>`;
  const progressBar = renderProgressBar(path, left, progressTop, gridWidth, dark);

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${username} GitHub contribution snake</title>
  <desc id="desc">A blue animated snake with a larger head moves through ${username}'s live GitHub contribution grid while the progress bar tracks the animation.</desc>
  <g>${cells.join("\n")}</g>
  <g aria-label="Animated blue contribution snake">
    ${body}
    ${head}
  </g>
  ${progressBar}
</svg>
`;
}

async function main() {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  const data = await requestGraphQL(query, { login: username });
  const weeks = data.user.contributionsCollection.contributionCalendar.weeks;

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(`${outputDir}/github-contribution-grid-snake.svg`, render(weeks, false));
  fs.writeFileSync(`${outputDir}/github-contribution-grid-snake-dark.svg`, render(weeks, true));

  console.log(`Generated live blue contribution snake for ${username}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
