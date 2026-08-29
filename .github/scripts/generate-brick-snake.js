const fs = require("fs");
const https = require("https");
const { execFileSync } = require("child_process");

const username = process.env.GITHUB_REPOSITORY_OWNER || "Owen-kasule";
const token = process.env.GITHUB_TOKEN || getGhToken();

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

function contributionColor(count, dark) {
  if (dark) {
    if (count === 0) return "#f0f3f6";
    if (count < 5) return "#9be9a8";
    if (count < 15) return "#40c463";
    if (count < 30) return "#30a14e";
    return "#216e39";
  }

  if (count === 0) return "#ebedf0";
  if (count < 5) return "#9be9a8";
  if (count < 15) return "#40c463";
  if (count < 30) return "#30a14e";
  return "#216e39";
}

function animationValues(points, axis, segmentIndex) {
  const shifted = points.slice();
  for (let i = 0; i < segmentIndex; i += 1) {
    shifted.unshift(shifted[0]);
  }

  return shifted.map((point) => point[axis]).join(";");
}

function renderSvg(weeks, dark) {
  const cell = 11;
  const gap = 4;
  const step = cell + gap;
  const left = 34;
  const top = 78;
  const footerTop = top + 7 * step + 36;
  const gridWidth = weeks.length * step - gap;
  const width = left * 2 + gridWidth;
  const height = footerTop + 92;
  const bg = dark ? "#1f2933" : "#f6f8fa";
  const text = dark ? "#edf2f7" : "#1f2933";
  const muted = dark ? "#b8c2cc" : "#57606a";
  const stroke = dark ? "#263341" : "#d0d7de";
  const paddle = dark ? "#9BE9A8" : "#30a14e";
  const snakeColors = ["#CB9DF0", "#a855f7", "#8a00a8", "#7a007c", "#65006d", "#4c005c"];
  const cells = [];
  const pathPoints = [];

  weeks.forEach((week, weekIndex) => {
    const orderedDays = weekIndex % 2 === 0
      ? week.contributionDays
      : [...week.contributionDays].reverse();

    orderedDays.forEach((day) => {
      pathPoints.push({
        x: left + weekIndex * step,
        y: top + day.weekday * step,
      });
    });

    week.contributionDays.forEach((day) => {
      const x = left + weekIndex * step;
      const y = top + day.weekday * step;
      cells.push(
        `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${contributionColor(day.contributionCount, dark)}" stroke="${stroke}" stroke-width="0.45"><title>${day.date}: ${day.contributionCount} contributions</title></rect>`
      );
    });
  });

  const duration = "20s";
  const snake = Array.from({ length: 6 }, (_, index) => {
    const opacity = (1 - index * 0.12).toFixed(2);
    const size = index === 0 ? cell + 3 : cell;
    const offset = index === 0 ? -1.5 : 0;
    const xValues = animationValues(pathPoints, "x", index).split(";").map((value) => Number(value) + offset).join(";");
    const yValues = animationValues(pathPoints, "y", index).split(";").map((value) => Number(value) + offset).join(";");

    return `<rect width="${size}" height="${size}" rx="3" fill="${snakeColors[index]}" opacity="${opacity}">
      <animate attributeName="x" dur="${duration}" repeatCount="indefinite" calcMode="discrete" values="${xValues}" />
      <animate attributeName="y" dur="${duration}" repeatCount="indefinite" calcMode="discrete" values="${yValues}" />
    </rect>`;
  }).join("\n");

  const laneValues = Array.from({ length: 18 }, (_, index) => {
    const value = left + Math.round((gridWidth - 110) * (index / 17));
    return value;
  }).concat([left]).join(";");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${username} brick-game contribution snake</title>
  <desc id="desc">A blocky arcade-style snake moves cell by cell across ${username}'s GitHub contribution calendar.</desc>
  <style>
    .title { font: 700 28px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${text}; }
    .label { font: 700 13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; fill: ${muted}; letter-spacing: 1px; }
    .quote { font: 700 16px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${text}; }
    .author { font: 600 13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; fill: ${paddle}; letter-spacing: 1px; }
  </style>
  <rect width="100%" height="100%" rx="12" fill="${bg}" />
  <text class="title" x="${width / 2}" y="38" text-anchor="middle">Contribution Snake</text>
  <text class="label" x="${width / 2}" y="61" text-anchor="middle">BRICK MODE / ${username}</text>
  <g>${cells.join("\n")}</g>
  ${snake}
  <rect y="${footerTop}" width="118" height="12" rx="2" fill="${paddle}">
    <animate attributeName="x" dur="3.6s" repeatCount="indefinite" calcMode="linear" values="${laneValues}" />
  </rect>
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

  const outputDir = process.env.OUTPUT_DIR || "dist";

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(`${outputDir}/github-contribution-grid-snake.svg`, renderSvg(weeks, false));
  fs.writeFileSync(`${outputDir}/github-contribution-grid-snake-dark.svg`, renderSvg(weeks, true));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
