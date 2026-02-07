import { tavily, TavilyClient } from "@tavily/core";

// Lazy singleton — only initialized at runtime when env vars are available
let _client: TavilyClient | null = null;

function getClient(): TavilyClient {
  if (!_client) {
    const apiKey = Deno.env.get("TAVILY_API_KEY");
    if (!apiKey) {
      throw new Error("TAVILY_API_KEY is not set");
    }
    console.log("[Tavily] Initializing client...");
    _client = tavily({ apiKey });
    console.log("[Tavily] Client initialized successfully");
  }
  return _client;
}

export interface PersonQuery {
  name: string;
  company?: string;
  role?: string;
  location?: string;
  linkedinUrl?: string;
  additionalContext?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

/**
 * Build an optimized search query string from person details.
 */
function buildSearchQuery(person: PersonQuery): string {
  const parts: string[] = [person.name];

  if (person.role) parts.push(person.role);
  if (person.company) parts.push(person.company);
  if (person.location) parts.push(person.location);
  if (person.additionalContext) parts.push(person.additionalContext);

  return parts.join(" ");
}

/**
 * Search the web for information about a person using Tavily.
 * Builds an optimized search query from the person's details.
 */
export async function searchPerson(person: PersonQuery): Promise<SearchResult[]> {
  const query = buildSearchQuery(person);
  console.log("[searchPerson] Built query:", query);

  try {
    console.log("[searchPerson] Calling Tavily API...");
    const response = await getClient().search(query, {
      maxResults: 10,
      searchDepth: "advanced",
      includeAnswer: true,
    });
    console.log("[searchPerson] Tavily returned", response.results?.length || 0, "results");

    const results: SearchResult[] = response.results.map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
    }));

    // If Tavily provided an answer summary, include it as the first result
    if (response.answer) {
      console.log("[searchPerson] Tavily provided answer summary");
      results.unshift({
        title: "Tavily Summary",
        url: "",
        content: response.answer,
      });
    }

    console.log("[searchPerson] Returning", results.length, "total results");
    return results;
  } catch (error) {
    console.error("[searchPerson] Tavily API error:", error);
    throw error;
  }
}

/**
 * If a LinkedIn URL is provided, extract content directly from it.
 */
export async function extractFromUrl(url: string): Promise<string> {
  try {
    const response = await getClient().extract([url]);
    if (response.results && response.results.length > 0) {
      return response.results.map((r) => r.rawContent).join("\n\n");
    }
    return "";
  } catch {
    console.error(`Failed to extract content from ${url}`);
    return "";
  }
}
