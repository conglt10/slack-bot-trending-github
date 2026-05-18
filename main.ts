import * as cheerio from "npm:cheerio@1";
import { Cron } from "jsr:@hexagon/croner@10.0.1";
import { WebClient } from "npm:@slack/web-api";

const slackClient = new WebClient(Deno.env.get("SLACK_BOT_TOKEN"));
const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
const openRouterModel = Deno.env.get("OPENROUTER_MODEL") || "openai/gpt-oss-120b:free";
const cronExpr = Deno.args[0];
const defaultCronExpr = "0 14 * * 1"; // Every Monday at 14h

interface GitHubRepo {
  title: string;
  url: string;
  description: string;
  stars: string;
  forks: string;
  language: string[];
  trendingReason?: string;
}

async function fetchAllLanguages(repoUrl: string): Promise<string[]> {
  try {
    const response = await fetch(repoUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
    if (!response.ok) return ["Unknown"];

    const html = await response.text();
    const $ = cheerio.load(html);
    const languages: string[] = [];

    $("ul.RepositoryProgress-list li, a.d-inline-flex.flex-items-center.flex-nowrap.no-underline").each((_, element) => {
      const text = $(element).text().replace(/\s+/g, " ").trim();
      if (text) {
        languages.push(text);
      }
    });

    if (languages.length === 0) {
      $("span.color-fg-default.text-bold").each((_, element) => {
        const name = $(element).text().trim();
        const percent = $(element).next("span").text().trim();
        if (name) {
          languages.push(`${name} ${percent}`);
        }
      });
    }

    return languages.length > 0 ? languages : ["Unknown"];
  } catch (error) {
    console.error(`Lỗi khi lấy ngôn ngữ chi tiết tại ${repoUrl}:`, error);
    return ["Unknown"];
  }
}

async function fetchGitHubTrending(): Promise<GitHubRepo[]> {
  try {
    const response = await fetch("https://github.com/trending", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
    const html = await response.text();
    const $ = cheerio.load(html);
    const baseRepos: Omit<GitHubRepo, "languages">[] = [];

    $("article.Box-row").each((idx, element) => {
      const $repo = $(element);
      const titleLink = $repo.find("h2.h3 a");
      const title = titleLink.text().replace(/\s+/g, "").trim();
      const url = `https://github.com${titleLink.attr("href")}`;
      const description = $repo.find("p.col-9").text().trim();

      const metaText = $repo.find("div.f6.color-fg-muted");
      const stars = metaText.find(`a[href$="/stargazers"]`).text().trim();
      const forks = metaText.find(`a[href$="/forks"]`).text().trim();

      baseRepos.push({ title, url, description, stars, forks });
    });

    const fullRepos: GitHubRepo[] = [];

    for (const repo of baseRepos) {
      console.log(`Đang quét danh sách ngôn ngữ của: ${repo.title}...`);
      const languages = await fetchAllLanguages(repo.url);

      fullRepos.push({
        ...repo,
        languages
      });

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return fullRepos;
  } catch (error) {
    console.error("Lỗi khi cào dữ liệu từ GitHub:", error);
    return [];
  }
}

async function analyzeWhyItIsTrending(repos: GitHubRepo[]): Promise<string> {
  try {
    const fallbackReasons = repos.map(() => "");

    if (!openRouterApiKey) {
      return fallbackReasons;
    }

    const repoListString = repos.map((r, i) =>
      `Repo #${i + 1}:\n- Tên: ${r.title}\n- Các ngôn ngữ sử dụng: ${r.languages.join(", ")}\n- Mô tả: ${r.description}`
    ).join("\n\n");

    const prompt = `Bạn là một chuyên gia công nghệ. Hãy phân tích ngắn gọn trong 1-2 câu lý do tại sao từng kho lưu trữ (repository) dưới đây lại đang thịnh hành (trending) trên GitHub gần đây dựa trên tên, các cấu trúc ngôn ngữ và mô tả của nó.
      
    Yêu cầu bắt buộc về định dạng đầu ra:
    Trả về duy nhất một mảng JSON chứa các chuỗi văn bản (Array of strings) theo đúng thứ tự các repo.
    Ví dụ cấu trúc trả về bắt buộc:
    [
      "Lý do repo 1 hot...",
      "Lý do repo 2 hot..."
    ]

    Tuyệt đối không viết thêm bất kỳ chữ giải thích nào ngoài khối mảng JSON này.
    Kết quả trả về sử dụng tiếng Việt

    Dưới đây là danh sách repo cần phân tích:
    ${repoListString}`;

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: openRouterModel,
          messages: [{ role: "user", content: prompt }],
          tools: [{ type: "openrouter:web_search" }],
        }),
      }
    );

    const data = await response.json();
    const rawText = data?.choices?.[0]?.message?.content?.trim();

    if (!rawText) {
      console.warn("Mô hình AI trả về nội dung rỗng.");
      return fallbackReasons;
    }

    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }

    const parsedData = JSON.parse(rawText);

    if (Array.isArray(parsedData)) {
      return parsedData;
    } else if (parsedData.reasons && Array.isArray(parsedData.reasons)) {
      return parsedData.reasons;
    } else if (typeof parsedData === "object") {
      return Object.values(parsedData) as string[];
    }

    throw new Error("Không thể trích xuất mảng dữ liệu từ JSON của AI.");
  } catch (error) {
    console.error(`Lỗi phân tích repo ${repo.title}:`, error);
    return fallbackReasons;
  }
}

async function sendToSlack(repos: GitHubRepo[]) {
  const channel = Deno.env.get("SLACK_CHANNEL");
  if (!channel) {
    console.error("Thiếu SLACK_CHANNEL trong file .env");
    return;
  }

  const mainBlocks: any[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🚀 BẢN TIN XU HƯỚNG TRÊN GITHUB",
        emoji: true,
      },
    },
  ];

  let thread_ts: string | undefined;

  try {
    const response = await slackClient.chat.postMessage({
      channel,
      text: "🚀 XU HƯỚNG TRÊN GITHUB TRONG TUẦN",
      blocks: mainBlocks,
    });
    thread_ts = response.ts;
    console.log("Đã gửi tin nhắn chính lên Slack thành công!");
  } catch (error) {
    console.error("Lỗi khi gửi tin nhắn chính Slack:", error);
    return;
  }

  if (!thread_ts) {
    console.error("Không nhận được thread_ts từ Slack Response.");
    return;
  }

  const threadBlocks: any[] = [];
  for (const repo of repos) {
    const languageTags = repo.languages.map(lang => `\`${lang}\``).join(" ｜ ");

    if (threadBlocks.length >= 50) {
      break;
    }

    threadBlocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*⭐ <${repo.url}|${repo.title}>*\n🛠️ *Ngôn ngữ:* ${languageTags}\n📝 _${repo.description || "Không có mô tả sơ bộ."}_\n📊 *Stars:* ${repo.stars} | *Forks:* ${repo.forks}\n${repo.trendingReason?.trim()?.length > 0 ? `💡 *Tại sao đang HOT:* ${repo.trendingReason}` : ""}`,
      },
    });
  }

  if (threadBlocks.length > 0) {
    try {
      await slackClient.chat.postMessage({
        channel,
        thread_ts,
        text: "Chi tiết các dự án trending:",
        blocks: threadBlocks,
      });
      console.log("Đã gửi nội dung chi tiết vào thread thành công!");
    } catch (error) {
      console.error("Lỗi khi gửi tin nhắn thread Slack:", error);
    }
  }
}

async function runJob() {
  console.log("Bắt đầu xử lý dữ liệu GitHub Trending...");
  const repos = await fetchGitHubTrending();

  const reasons = await analyzeWhyItIsTrending(repos);

  repos.forEach((repo, index) => {
    repo.trendingReason = reasons[index] || "";
  });

  await sendToSlack(repos);
}

function isValidCron(expression: string): boolean {
  try {
    new Cron(expression, () => { });
    return true;
  } catch (error) {
    return false;
  }
}

function startScheduler() {
  let cronExpression = isValidCron(cronExpr) ? cronExpr : defaultCronExpr;

  console.log(
    `Đang khởi chạy Scheduler với chế độ: (Cron: ${cronExpression})`
  );

  new Cron(cronExpression, { timezone: "Asia/Ho_Chi_Minh" }, () => {
    runJob();
  });
}

startScheduler();
