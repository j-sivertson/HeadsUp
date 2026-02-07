import { tavily } from "@tavily/core";

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY! });

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
 * Search the web for information about a person using Tavily.
 * Builds an optimized search query from the person's details.
 */
export async function searchPerson(person: PersonQuery): Promise<SearchResult[]> {
  const query = buildSearchQuery(person);

  const response = await tavilyClient.search(query, {
    maxResults: 10,
    searchDepth: "advanced",
    includeAnswer: true,
  });

  const results: SearchResult[] = response.results.map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }));

  // If Tavily provided an answer summary, include it as the first result
  if (response.answer) {
    results.unshift({
      title: "Tavily Summary",
      url: "",
      content: response.answer,
    });
  }

  return results;
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
 * If a LinkedIn URL is provided, extract content directly from it.
 */
export async function extractFromUrl(url: string): Promise<string> {
  try {
    const response = await tavilyClient.extract([url]);
    if (response.results && response.results.length > 0) {
      return response.results.map((r) => r.rawContent).join("\n\n");
    }
    return "";
  } catch {
    console.error(`Failed to extract content from ${url}`);
    return "";
  }
}

export { tavilyClient };
