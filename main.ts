import * as cheerio from "npm:cheerio@1";
import { Cron } from "jsr:@hexagon/croner@10.0.1";
import { WebClient } from "npm:@slack/web-api";

const slackClient = new WebClient(Deno.env.get("SLACK_BOT_TOKEN"));
const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");

interface GitHubRepo {
  title: string;
  url: string;
  description: string;
  stars: string;
  forks: string;
  language: string;
  trendingReason?: string;
}

async function fetchGitHubTrending(): Promise<GitHubRepo[]> {
  try {
    const response = await fetch("https://github.com/trending", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    const html = await response.text();

    const $ = cheerio.load(html);
    const repos: GitHubRepo[] = [];

    $("article.Box-row").each((_idx: number, element: cheerio.Element) => {
      const $repo = $(element);
      const titleLink = $repo.find("h2.h3 a");
      const title = titleLink.text().replace(/\s+/g, "").trim();
      const url = `https://github.com${titleLink.attr("href")}`;
      const description = $repo.find("p.col-9").text().trim();
      const language =
        $repo.find('[itemprop="programmingLanguage"]').text().trim() ||
        "Unknown";

      const metaText = $repo.find("div.f6.color-fg-muted");
      const stars = metaText.find(`a[href$="/stargazers"]`).text().trim();
      const forks = metaText.find(`a[href$="/forks"]`).text().trim();

      repos.push({ title, url, description, language, stars, forks });
    });

    return repos;
  } catch (error) {
    console.error("Lỗi khi cào dữ liệu GitHub:", error);
    return [];
  }
}

async function analyzeWhyItIsTrending(repo: GitHubRepo): Promise<string> {
  if (!openRouterApiKey) {
    return "";
  }

  try {
    const prompt = `Bạn là một chuyên gia công nghệ. Hãy phân tích ngắn gọn trong 1-2 câu lý do vì sao kho lưu trữ (repository) GitHub sau đây lại đang thịnh hành (trending). Dựa vào tên, ngôn ngữ và mô tả của nó. Trả lời bằng tiếng Việt.
    - Tên: ${repo.title}
    - Ngôn ngữ: ${repo.language}
    - Mô tả: ${repo.description}`;
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "nvidia/nemotron-3-super-120b-a12b:free",
          messages: [{ role: "user", content: prompt }],
          tools: [{ type: "openrouter:web_search" }],
        }),
      }
    );

    const data = await response.json();
    const reason = data.choices[0].message.content;
    return reason ? reason.trim() : "Chưa có phân tích cụ thể.";
  } catch (error) {
    console.error(`Lỗi phân tích repo ${repo.title}:`, error);
    return "Lỗi khi kết nối với AI để phân tích.";
  }
}

async function sendToSlack(repos: GitHubRepo[]) {
  const channel = Deno.env.get("SLACK_CHANNEL");
  if (!channel) {
    console.error("Thiếu SLACK_CHANNEL trong file .env");
    return;
  }

  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🚀 BẢN TIN XU HƯỚNG TRÊN GITHUB",
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*Thời gian:* ${new Date().toLocaleDateString("vi-VN")} | Tự động cập nhật`,
        },
      ],
    },
    { type: "divider" },
  ];

  for (const repo of repos) {
    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*⭐ <${repo.url}|${repo.title}>* (${repo.language})\n📝 _${repo.description || "Không có mô tả."}_\n📊 *Stars:* ${repo.stars} | *Forks:* ${repo.forks}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `💡 *Vì sao đang hot:* ${repo.trendingReason}`,
        },
      },
      { type: "divider" }
    );
  }

  try {
    await slackClient.chat.postMessage({
      channel,
      text: "Cập nhật tình hình GitHub Trending!",
      blocks,
    });
    console.log("Đã gửi báo cáo lên Slack thành công!");
  } catch (error) {
    console.error("Lỗi khi gửi tin nhắn Slack:", error);
  }
}

async function runJob() {
  console.log("Bắt đầu xử lý dữ liệu GitHub Trending...");
  const repos = await fetchGitHubTrending();

  await Promise.all(
    repos.map(async (repo) => {
      repo.trendingReason = await analyzeWhyItIsTrending(repo);
    })
  );

  await sendToSlack(repos);
}

function startScheduler(frequency: "weekly" | "multi-weekly" = "weekly") {
  let cronExpression = "0 14 * * 1"; // Every Monday at 14h

  if (frequency === "multi-weekly") {
    cronExpression = "0 14 * * 1,3,5"; // Mon, Wed, Fri at 14h
  }
  cronExpression = "12 10 * * *"
  console.log(
    `Đang khởi chạy Scheduler với chế độ: [${frequency}] (Cron: ${cronExpression})`
  );

  new Cron(cronExpression, () => {
    runJob();
  });
}

startScheduler("multi-weekly");
