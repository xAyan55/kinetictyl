import crypto from 'crypto';
import { encodeTarget } from '../../../utils/urlSafe';

export class LinkBuilder {
  private publisherId: string;
  private targetUrl: string = '';
  private token: string = '';
  private campaign: string = 'general';
  private placement: string = 'default';
  private rewardType: string = 'COINS';
  private rewardAmount: number = 0;
  private callbackUrl: string = '';

  // Supported Linkvertise domains for dynamic links
  private static readonly DYNAMIC_DOMAINS = [
    'link-to.net',
    'direct-link.net',
    'up-to-down.net',
  ];

  constructor(publisherId: string) {
    this.publisherId = publisherId;
  }

  setTargetUrl(url: string): this {
    this.targetUrl = url;
    return this;
  }

  setToken(token: string): this {
    this.token = token;
    return this;
  }

  setCampaign(campaign: string): this {
    this.campaign = campaign;
    return this;
  }

  setPlacement(placement: string): this {
    this.placement = placement;
    return this;
  }

  setReward(type: string, amount: number): this {
    this.rewardType = type;
    this.rewardAmount = amount;
    return this;
  }

  /**
   * Set the base URL for our callback endpoint (e.g., https://panel.example.com).
   * The callback URL is used as the actual target of the Linkvertise dynamic link
   * so that we can process completions server-side.
   */
  setCallbackUrl(url: string): this {
    this.callbackUrl = url.replace(/\/+$/, '');
    return this;
  }

  /**
   * Validate that the current builder state is capable of producing
   * a valid Linkvertise dynamic link. Throws on first invalid state.
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.publisherId || this.publisherId.trim().length === 0) {
      errors.push('Publisher ID is empty');
    } else if (!/^\d+$/.test(this.publisherId.trim())) {
      errors.push('Publisher ID must be numeric');
    }

    if (!this.targetUrl) {
      errors.push('Target URL is empty');
    } else {
      try {
        const parsed = new URL(this.targetUrl);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          errors.push('Target URL must use http or https protocol');
        }
      } catch {
        errors.push('Target URL is malformed');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Build the final Linkvertise Dynamic Link URL.
   *
   * The official Linkvertise Dynamic Link format is:
   *   https://link-to.net/{publisherId}/{random}/dynamic?r={encodedTarget}
   *
   * Where:
   * - publisherId: numeric account ID
   * - random: a random float (acts as a unique post identifier per session)
   * - r: base64url-encoded and URI-escaped target URL
   *
   * The token/callback metadata is embedded IN the target URL (r parameter),
   * not as separate query params, because Linkvertise ignores unknown params.
   */
  build(): string {
    // Generate a random float between 100 and 999999 for the path segment
    const random = (Math.random() * (999999 - 100) + 100).toString();

    // Determine the effective target: if we have both a callbackUrl and a token,
    // wrap the original target in our callback so we can process completions.
    let effectiveTarget = this.targetUrl;
    if (this.callbackUrl && this.token) {
      const callbackParams = new URLSearchParams({
        token: this.token,
        redirect: this.targetUrl,
        campaign: this.campaign,
        placement: this.placement,
      });
      effectiveTarget = `${this.callbackUrl}/api/v1/earn/linkvertise-complete?${callbackParams.toString()}`;
    } else if (this.token) {
      // Fallback: embed token directly in target URL
      const sep = this.targetUrl.includes('?') ? '&' : '?';
      effectiveTarget = `${this.targetUrl}${sep}lv_token=${encodeURIComponent(this.token)}`;
    }

    const encoded = encodeTarget(effectiveTarget);

    return `https://link-to.net/${this.publisherId}/${random}/dynamic?r=${encoded}`;
  }

  /**
   * Validate the generated Linkvertise URL structure.
   */
  validateGeneratedUrl(url: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!url) {
      errors.push('Generated URL is empty');
      return { valid: false, errors };
    }

    try {
      const parsed = new URL(url);

      // Check domain is a known Linkvertise domain
      const domainOk = LinkBuilder.DYNAMIC_DOMAINS.some(d =>
        parsed.hostname === d || parsed.hostname.endsWith('.' + d)
      );
      if (!domainOk) {
        errors.push(`URL domain "${parsed.hostname}" is not a known Linkvertise domain`);
      }

      // Check path pattern: /{publisherId}/{random}/dynamic
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (pathParts.length !== 3 || pathParts[2] !== 'dynamic') {
        errors.push(`URL path structure is invalid: "${parsed.pathname}" (expected /{id}/{random}/dynamic)`);
      } else {
        if (!/^\d+$/.test(pathParts[0])) {
          errors.push(`Publisher ID in URL "${pathParts[0]}" is not numeric`);
        }
        if (!/^\d+(\.\d+)?$/.test(pathParts[1])) {
          errors.push(`Random segment "${pathParts[1]}" is not a valid number`);
        }
      }

      // Check required r parameter
      const rParam = parsed.searchParams.get('r');
      if (!rParam) {
        errors.push('Missing required "r" query parameter');
      } else if (rParam.length < 5) {
        errors.push('The "r" parameter appears too short to be valid');
      }

      // Check no unknown query params that Linkvertise might reject
      const allowedParams = ['r'];
      const extraParams: string[] = [];
      parsed.searchParams.forEach((_, key) => {
        if (!allowedParams.includes(key)) {
          extraParams.push(key);
        }
      });

    } catch {
      errors.push('Generated URL is malformed and cannot be parsed');
    }

    return { valid: errors.length === 0, errors };
  }

  buildOffer(token: string, target: string, rewardAmount: number): string {
    return this.setToken(token)
      .setTargetUrl(target)
      .setCampaign('earn')
      .setPlacement('offer_wall')
      .setReward('COINS', rewardAmount)
      .build();
  }

  buildReward(token: string, target: string, rewardAmount: number): string {
    return this.setToken(token)
      .setTargetUrl(target)
      .setCampaign('bonus')
      .setPlacement('daily_reward')
      .setReward('COINS', rewardAmount)
      .build();
  }

  buildAFK(token: string, target: string): string {
    return this.setToken(token)
      .setTargetUrl(target)
      .setCampaign('afk')
      .setPlacement('afk_page')
      .build();
  }

  buildStore(token: string, target: string, amount: number): string {
    return this.setToken(token)
      .setTargetUrl(target)
      .setCampaign('store')
      .setPlacement('store_purchase')
      .setReward('COINS', amount)
      .build();
  }

  buildCustom(token: string, target: string, campaign: string, placement: string): string {
    return this.setToken(token)
      .setTargetUrl(target)
      .setCampaign(campaign)
      .setPlacement(placement)
      .build();
  }
}
