const fs = require('fs');
const https = require('https');

const username = process.env.GITHUB_REPOSITORY_OWNER || 'Owen-kasule';
const token = process.env.GITHUB_TOKEN || '';
const outDir = process.env.OUTPUT_DIR || 'dist';
const C = {
  black: '#06070C',
  navy: '#10162A',
  blue: '#1D4ED8',
  sky: '#60A5FA',
  white: '#F8FAFC',
  muted: '#A9B4C5',
  border: '#2A3550',
};

function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmt(value) {
  return new Intl.NumberFormat('en-US', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value || 0);
}

function requestJson(path, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `${username}-profile-widgets`,
        ...extraHeaders,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GitHub API ${res.statusCode} for ${path}: ${data.slice(0, 300)}`));
          return;
        }
        try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function requestGraphql(query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'api.github.com',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': `${username}-profile-widgets`,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GitHub GraphQL ${res.statusCode}: ${data.slice(0, 300)}`));
          return;
        }
        const parsed = JSON.parse(data);
        if (parsed.errors) return reject(new Error(JSON.stringify(parsed.errors)));
        resolve(parsed.data);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function externalJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': `${username}-profile-widgets`, ...headers } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`External API ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
  });
}

function svgFrame(width, height, title, body, desc = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${esc(title)}</title><desc id="desc">${esc(desc || title)}</desc>
<style>
  .title{font:700 28px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;fill:${C.sky}}
  .label{font:600 16px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;fill:${C.muted}}
  .value{font:800 32px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;fill:${C.white}}
  .body{font:500 16px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;fill:${C.white}}
  .small{font:500 13px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;fill:${C.muted}}
</style>
<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="14" fill="${C.navy}" stroke="${C.blue}" stroke-width="2"/>
<text class="title" x="28" y="46">${esc(title)}</text>
${body}
</svg>`;
}

function write(name, content) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${outDir}/${name}`, content);
}

async function getRepos() {
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await requestJson(`/users/${encodeURIComponent(username)}/repos?per_page=100&page=${page}&type=owner&sort=updated`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all.filter(repo => !repo.archived);
}

async function getContributionData() {
  const query = `
    query($login: String!) {
      user(login: $login) {
        followers { totalCount }
        contributionsCollection {
          totalCommitContributions
          totalIssueContributions
          totalPullRequestContributions
          totalPullRequestReviewContributions
          restrictedContributionsCount
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays { date contributionCount weekday }
            }
          }
        }
      }
    }`;
  return requestGraphql(query, { login: username });
}

function streaks(days) {
  const sorted = days.slice().sort((a, b) => a.date.localeCompare(b.date));
  let longest = 0, run = 0, longestStart = '', longestEnd = '', runStart = '';
  for (const day of sorted) {
    if (day.contributionCount > 0) {
      if (run === 0) runStart = day.date;
      run += 1;
      if (run > longest) { longest = run; longestStart = runStart; longestEnd = day.date; }
    } else { run = 0; runStart = ''; }
  }
  let current = 0, currentStart = '', currentEnd = '';
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const day = sorted[i];
    if (day.contributionCount === 0) {
      if (current === 0 && i === sorted.length - 1) continue;
      break;
    }
    current += 1;
    currentStart = day.date;
    if (!currentEnd) currentEnd = day.date;
  }
  return { current, currentStart, currentEnd, longest, longestStart, longestEnd };
}

function renderSummary(stats) {
  const metrics = [
    ['Public Repositories', stats.repos],
    ['Public Commits', stats.commits],
    ['Pull Requests', stats.prs],
    ['Repository Stars', stats.stars],
    ['Forks', stats.forks],
    ['Contributions (1y)', stats.contributions],
  ];
  let body = '';
  metrics.forEach(([label, value], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 28 + col * 286, y = 78 + row * 112;
    body += `<rect x="${x}" y="${y}" width="258" height="88" rx="12" fill="${C.black}" stroke="${C.border}"/>
      <text class="value" x="${x + 18}" y="${y + 40}">${esc(fmt(value))}</text>
      <text class="label" x="${x + 18}" y="${y + 68}">${esc(label)}</text>`;
  });
  return svgFrame(900, 320, 'GitHub Readme Stats Dashboard', body, 'Live GitHub statistics generated from the GitHub API.');
}

function renderLanguages(languages) {
  const top = Object.entries(languages).sort((a,b) => b[1]-a[1]).slice(0, 8);
  const total = top.reduce((sum, [,v]) => sum + v, 0) || 1;
  let body = '';
  top.forEach(([name, bytes], i) => {
    const pct = bytes / total;
    const y = 78 + i * 39;
    const barW = Math.max(8, Math.round(620 * pct));
    const fill = i % 2 === 0 ? C.blue : C.sky;
    body += `<text class="body" x="28" y="${y + 17}">${esc(name)}</text>
      <rect x="190" y="${y}" width="620" height="22" rx="7" fill="${C.black}"/>
      <rect x="190" y="${y}" width="${barW}" height="22" rx="7" fill="${fill}"/>
      <text class="small" x="825" y="${y + 16}">${(pct*100).toFixed(1)}%</text>`;
  });
  if (!top.length) body += `<text class="body" x="28" y="100">No public language data available yet.</text>`;
  return svgFrame(900, 420, 'Top Programming Languages', body, 'Language usage aggregated from public repositories.');
}

function renderContributionGraph(weeks) {
  const totals = weeks.map(w => w.contributionDays.reduce((s,d) => s + d.contributionCount, 0));
  const max = Math.max(1, ...totals);
  const left = 60, top = 78, width = 980, height = 190;
  const points = totals.map((v, i) => {
    const x = left + (i * width / Math.max(1, totals.length - 1));
    const y = top + height - (v / max) * height;
    return [x, y];
  });
  const poly = points.map(p => p.join(',')).join(' ');
  const area = `${left},${top+height} ${poly} ${left+width},${top+height}`;
  let grid = '';
  for (let i=0;i<=4;i++) {
    const y = top + i * height / 4;
    grid += `<line x1="${left}" y1="${y}" x2="${left+width}" y2="${y}" stroke="${C.border}" stroke-width="1"/>`;
  }
  const body = `${grid}<polygon points="${area}" fill="${C.blue}" opacity="0.18"/>
    <polyline points="${poly}" fill="none" stroke="${C.sky}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
    <text class="small" x="${left}" y="292">52-week contribution activity</text>
    <text class="small" x="${left+width}" y="292" text-anchor="end">Peak week: ${fmt(max)} contributions</text>`;
  return svgFrame(1100, 320, 'GitHub Contribution Chart', body, 'Weekly contribution totals from GitHub.');
}

function wrap(text, max = 55) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = []; let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > max && line) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  return lines.slice(0, 2);
}

function renderRepos(repos) {
  const preferred = ['TransparentSpark','wdd430-group05-handcrafted-haven','wow-shoppers-lite','SoundHire-Data-Analysis'];
  const chosen = preferred.map(name => repos.find(r => r.name === name)).filter(Boolean);
  const fallback = repos.filter(r => !r.fork).sort((a,b) => b.stargazers_count - a.stargazers_count || new Date(b.updated_at)-new Date(a.updated_at));
  for (const repo of fallback) if (chosen.length < 4 && !chosen.some(r => r.name === repo.name)) chosen.push(repo);
  let body = '';
  chosen.slice(0,4).forEach((repo, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 28 + col * 522, y = 76 + row * 158;
    const lines = wrap(repo.description || 'Public GitHub repository', 54);
    body += `<rect x="${x}" y="${y}" width="494" height="132" rx="12" fill="${C.black}" stroke="${C.border}"/>
      <text class="title" style="font-size:20px" x="${x+18}" y="${y+31}">${esc(repo.name)}</text>
      <text class="body" x="${x+18}" y="${y+59}">${esc(lines[0] || '')}</text>
      <text class="body" x="${x+18}" y="${y+82}">${esc(lines[1] || '')}</text>
      <text class="small" x="${x+18}" y="${y+112}">${esc(repo.language || 'Mixed')}   ★ ${fmt(repo.stargazers_count)}   Forks ${fmt(repo.forks_count)}</text>`;
  });
  return svgFrame(1100, 420, 'Top Repositories', body, 'Featured repositories generated directly from GitHub repository data.');
}

function renderStreak(streak) {
  const body = `<rect x="28" y="86" width="254" height="128" rx="12" fill="${C.black}" stroke="${C.border}"/>
    <text class="value" x="155" y="139" text-anchor="middle">${streak.current}</text>
    <text class="label" x="155" y="170" text-anchor="middle">Current Streak</text>
    <text class="small" x="155" y="195" text-anchor="middle">${esc(streak.currentStart || 'No active streak')} ${streak.currentEnd ? `to ${esc(streak.currentEnd)}` : ''}</text>
    <rect x="310" y="86" width="254" height="128" rx="12" fill="${C.black}" stroke="${C.border}"/>
    <text class="value" x="437" y="139" text-anchor="middle">${streak.longest}</text>
    <text class="label" x="437" y="170" text-anchor="middle">Longest Streak</text>
    <text class="small" x="437" y="195" text-anchor="middle">${esc(streak.longestStart || 'Not available')} ${streak.longestEnd ? `to ${esc(streak.longestEnd)}` : ''}</text>
    <rect x="592" y="86" width="280" height="128" rx="12" fill="${C.black}" stroke="${C.border}"/>
    <text class="value" x="732" y="139" text-anchor="middle">LIVE</text>
    <text class="label" x="732" y="170" text-anchor="middle">GitHub API</text>
    <text class="small" x="732" y="195" text-anchor="middle">Updated by Actions</text>`;
  return svgFrame(900, 250, 'GitHub Streak', body, 'Current and longest contribution streak.');
}

function renderTrophies(stats) {
  const items = [
    ['COMMITS', stats.commits], ['REPOS', stats.repos], ['PRs', stats.prs], ['STARS', stats.stars], ['FOLLOWERS', stats.followers]
  ];
  let body = '';
  items.forEach(([label, value], i) => {
    const x = 28 + i * 194;
    body += `<circle cx="${x+82}" cy="132" r="48" fill="${C.black}" stroke="${i%2 ? C.sky : C.blue}" stroke-width="5"/>
      <text class="value" x="${x+82}" y="142" text-anchor="middle" style="font-size:25px">${esc(fmt(value))}</text>
      <text class="label" x="${x+82}" y="207" text-anchor="middle">${esc(label)}</text>`;
  });
  return svgFrame(1000, 245, 'GitHub Trophies', body, 'Milestone-style GitHub metrics generated locally.');
}

async function renderWakaTime() {
  const wakaUser = process.env.WAKATIME_USERNAME || username;
  let payload = null;
  try {
    payload = await externalJson(`https://wakatime.com/api/v1/users/${encodeURIComponent(wakaUser)}/stats/last_7_days`);
  } catch (_) {
    const key = process.env.WAKATIME_API_KEY;
    if (key) {
      try {
        payload = await externalJson('https://wakatime.com/api/v1/users/current/stats/last_7_days', {
          Authorization: `Basic ${Buffer.from(key).toString('base64')}`,
        });
      } catch (_) {}
    }
  }
  const langs = payload?.data?.languages?.slice(0, 7) || [];
  if (!langs.length) {
    const body = `<rect x="28" y="82" width="844" height="160" rx="12" fill="${C.black}" stroke="${C.border}"/>
      <text class="value" x="450" y="137" text-anchor="middle" style="font-size:26px">WakaTime widget is ready</text>
      <text class="body" x="450" y="176" text-anchor="middle">Add WAKATIME_API_KEY as a repository secret to populate private coding metrics.</text>
      <text class="small" x="450" y="208" text-anchor="middle">If your public WakaTime username matches, this card will populate automatically.</text>`;
    return svgFrame(900, 285, 'WakaTime Coding Metrics', body, 'WakaTime metrics fallback card.');
  }
  const max = Math.max(...langs.map(l => l.total_seconds || 0), 1);
  let body = '';
  langs.forEach((lang, i) => {
    const y = 76 + i*36;
    const w = Math.max(8, 560 * (lang.total_seconds || 0) / max);
    body += `<text class="body" x="28" y="${y+16}">${esc(lang.name)}</text>
      <rect x="190" y="${y}" width="560" height="20" rx="6" fill="${C.black}"/>
      <rect x="190" y="${y}" width="${w}" height="20" rx="6" fill="${i%2 ? C.sky : C.blue}"/>
      <text class="small" x="770" y="${y+15}">${esc(lang.text || '')}</text>`;
  });
  return svgFrame(900, 350, 'WakaTime Coding Metrics', body, 'Coding time from WakaTime for the last seven days.');
}

function renderQuote() {
  const body = `<text class="body" x="450" y="103" text-anchor="middle" style="font-size:24px;font-weight:700">“The best way to predict the future is to invent it.”</text>
    <text class="label" x="450" y="139" text-anchor="middle">Alan Kay</text>`;
  return svgFrame(900, 175, 'Developer Quote', body);
}

function renderFooter() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="150" viewBox="0 0 1200 150" role="img" aria-label="Thanks for visiting">
    <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${C.black}"/><stop offset=".28" stop-color="${C.navy}"/><stop offset=".58" stop-color="${C.blue}"/><stop offset=".82" stop-color="${C.sky}"/><stop offset="1" stop-color="${C.white}"/></linearGradient></defs>
    <path d="M0,64 C180,130 340,12 530,70 C720,128 910,18 1200,78 L1200,150 L0,150 Z" fill="url(#g)"/>
    <text x="600" y="112" text-anchor="middle" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif" font-size="30" font-weight="800" fill="${C.white}">Thanks for visiting!</text>
  </svg>`;
}

async function main() {
  if (!token) throw new Error('GITHUB_TOKEN is required');
  const repos = await getRepos();
  const contributionData = await getContributionData();
  const cc = contributionData.user.contributionsCollection;
  const weeks = cc.contributionCalendar.weeks;
  const days = weeks.flatMap(w => w.contributionDays);

  const [commitSearch, prSearch] = await Promise.all([
    requestJson(`/search/commits?q=${encodeURIComponent(`author:${username}`)}&per_page=1`),
    requestJson(`/search/issues?q=${encodeURIComponent(`type:pr author:${username}`)}&per_page=1`),
  ]);

  const stats = {
    repos: repos.filter(r => !r.fork).length,
    commits: commitSearch.total_count || 0,
    prs: prSearch.total_count || 0,
    stars: repos.reduce((s,r) => s + (r.stargazers_count || 0), 0),
    forks: repos.reduce((s,r) => s + (r.forks_count || 0), 0),
    contributions: cc.contributionCalendar.totalContributions || 0,
    followers: contributionData.user.followers.totalCount || 0,
  };

  const languages = {};
  for (const repo of repos.filter(r => !r.fork)) {
    try {
      const data = await requestJson(`/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo.name)}/languages`);
      for (const [name, bytes] of Object.entries(data)) languages[name] = (languages[name] || 0) + bytes;
    } catch (error) {
      console.warn(`Skipping languages for ${repo.name}: ${error.message}`);
    }
  }

  const streak = streaks(days);
  write('github-summary.svg', renderSummary(stats));
  write('top-languages.svg', renderLanguages(languages));
  write('contribution-graph.svg', renderContributionGraph(weeks));
  write('top-repositories.svg', renderRepos(repos));
  write('github-streak.svg', renderStreak(streak));
  write('github-trophies.svg', renderTrophies(stats));
  write('wakatime.svg', await renderWakaTime());
  write('developer-quote.svg', renderQuote());
  write('footer-wave.svg', renderFooter());
  console.log('Generated self-hosted profile widgets in', outDir);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
