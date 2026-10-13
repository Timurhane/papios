/**
 * Instagram Graph API business discovery (K-8.4): public data of business accounts, using Timurhan's own
 * Meta app and business account. No scraping. Off until IG_BUSINESS_ACCOUNT_ID and IG_ACCESS_TOKEN exist.
 */
export interface InstagramProfile {
  username: string;
  name: string | null;
  biography: string | null;
  website: string | null;
  followers: number | null;
  mediaCount: number | null;
  lastPostAt: string | null;
}

export class InstagramDiscovery {
  constructor(
    private readonly businessAccountId: string,
    private readonly accessToken: string,
    private readonly apiVersion = 'v23.0',
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async lookup(handle: string): Promise<InstagramProfile | null> {
    const fields = `business_discovery.username(${handle}){username,name,biography,website,followers_count,media_count,media.limit(1){timestamp}}`;
    const url = new URL(`https://graph.facebook.com/${this.apiVersion}/${this.businessAccountId}`);
    url.searchParams.set('fields', fields);
    const res = await this.fetchFn(url.toString(), {
      headers: { authorization: `Bearer ${this.accessToken}` },
    });
    if (res.status === 400 || res.status === 404) return null; // not a business/creator account or not found
    if (!res.ok) throw new Error(`instagram graph error ${res.status}`);
    const data = (await res.json()) as {
      business_discovery?: {
        username: string;
        name?: string;
        biography?: string;
        website?: string;
        followers_count?: number;
        media_count?: number;
        media?: { data?: { timestamp?: string }[] };
      };
    };
    const b = data.business_discovery;
    if (!b) return null;
    return {
      username: b.username,
      name: b.name ?? null,
      biography: b.biography ?? null,
      website: b.website ?? null,
      followers: b.followers_count ?? null,
      mediaCount: b.media_count ?? null,
      lastPostAt: b.media?.data?.[0]?.timestamp ?? null,
    };
  }
}
