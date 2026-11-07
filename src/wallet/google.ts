import type { Membership, Store, User } from '@prisma/client';
import { GoogleAuth } from 'google-auth-library';
import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { stampProgress } from '../../shared/stampArt.js';
import { liveRewardWhere } from '../rewards.js';
import { absoluteLogoUrl } from '../stores.js';
import { artUrl } from './art.js';
import { cardUrl, passDetails, passLinks } from './passContent.js';
import type { WalletProvider } from './types.js';

const API = 'https://walletobjects.googleapis.com/walletobjects/v1';

/**
 * Google shows the member ID in a large box at the top of the card, so it gets a short
 * number ("4821 0937") instead of the database id. Derived from the id, so nothing to store.
 */
export function memberNumber(membershipId: string) {
  const digits = BigInt('0x' + createHash('sha256').update(membershipId).digest('hex').slice(0, 15)) % 100_000_000n;
  const s = digits.toString().padStart(8, '0');
  return `${s.slice(0, 4)} ${s.slice(4)}`;
}

type GoogleWalletConfig = { issuerId: string; clientEmail: string; privateKey: string };

export class GoogleWalletProvider implements WalletProvider {
  readonly name = 'google' as const;
  private auth: GoogleAuth;

  constructor(private cfg: GoogleWalletConfig) {
    this.auth = new GoogleAuth({
      credentials: { client_email: cfg.clientEmail, private_key: cfg.privateKey },
      scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'],
    });
  }

  private classId(store: Store) {
    return `${this.cfg.issuerId}.store_${store.id}`;
  }

  private objectId(membership: Membership) {
    return `${this.cfg.issuerId}.member_${membership.id}`;
  }

  /**
   * Everything on one customer's pass: balance, next reward, stamp picture, QR code and their
   * card link. Sent in full on every update, so older passes pick up new fields too.
   */
  private async progressFields(store: Store, membership: Membership) {
    const rewards = await prisma.reward.findMany({ where: { storeId: store.id, ...liveRewardWhere() }, select: { name: true, cost: true, icon: true } });
    const progress = stampProgress(rewards, membership.balance);
    const number = memberNumber(membership.id);
    const fields: Record<string, unknown> = {
      accountId: number,
      loyaltyPoints: { label: 'Stamps', balance: { int: membership.balance } },
      // The QR is the shop's join link, so a friend can scan it off your phone to join too.
      barcode: { type: 'QR_CODE', value: cardUrl(store), alternateText: `Member ${number}` },
      linksModuleData: { uris: [{ id: 'card', uri: cardUrl(store), description: 'Open my card: claim rewards, history, messages' }] },
    };
    if (!progress) return fields;
    fields.secondaryLoyaltyPoints =
      progress.toGo > 0
        ? { label: 'Next reward', balance: { string: `${progress.goal.name} · ${progress.toGo} to go` } }
        : { label: 'Ready to claim', balance: { string: progress.ready!.name } };
    // Google fetches images itself, so the picture is only set on a public https address.
    if (config.publicUrl.startsWith('https://')) {
      fields.heroImage = {
        sourceUri: { uri: artUrl(store, rewards, membership.balance) },
        contentDescription: { defaultValue: { language: 'en-US', value: `Reward progress: ${membership.balance} stamps` } },
      };
    }
    return fields;
  }

  private async call(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, data?: unknown) {
    const client = await this.auth.getClient();
    const res = await client.request({ url: `${API}${path}`, method, data, validateStatus: () => true });
    return { status: res.status, data: res.data as any };
  }

  /**
   * Writes a loyalty object. If Google can't download the stamp picture (server not
   * reachable, e.g. a dead tunnel), the card is still saved, just without the picture.
   */
  private async writeObject(method: 'POST' | 'PATCH', path: string, body: Record<string, unknown>) {
    const res = await this.call(method, path, body);
    if (res.status === 400 && body.heroImage && /image cannot be loaded/i.test(JSON.stringify(res.data))) {
      console.warn(`[google-wallet] Google couldn't load the stamp picture from ${config.publicUrl}; saving the card without it`);
      const { heroImage: _skip, ...rest } = body;
      return this.call(method, path, rest);
    }
    return res;
  }

  async upsertStoreCard(store: Store) {
    const logoUrl = absoluteLogoUrl(store.logoUrl);
    if (!logoUrl?.startsWith('https://')) {
      console.warn(`[google-wallet] store ${store.slug} needs a public https logo; skipping card sync`);
      return;
    }
    const [rewards, promotions] = await Promise.all([
      prisma.reward.findMany({ where: { storeId: store.id, ...liveRewardWhere() }, select: { name: true, cost: true, endsAt: true, perCustomerLimit: true } }),
      prisma.promotion.findMany({ where: { storeId: store.id } }),
    ]);
    const links = passLinks(store);
    const body = {
      id: this.classId(store),
      issuerName: store.name,
      // Shown big under the store name, so not "<store> Rewards" (it would repeat the name).
      programName: 'Rewards',
      accountIdLabel: 'Member no.',
      programLogo: { sourceUri: { uri: logoUrl }, contentDescription: { defaultValue: { language: 'en-US', value: store.name } } },
      hexBackgroundColor: store.bgColor,
      // Back of the pass: reward menu, happy hours, opening hours, how it works.
      textModulesData: passDetails(store, rewards, promotions),
      ...(links.length && { linksModuleData: { uris: links } }),
      // Google shows the pass on the customer's phone when they're near the shop.
      ...(store.latitude !== null && store.longitude !== null && { merchantLocations: [{ latitude: store.latitude, longitude: store.longitude }] }),
      reviewStatus: 'UNDER_REVIEW',
    };
    const inserted = await this.call('POST', '/loyaltyClass', body);
    if (inserted.status === 409) {
      const updated = await this.call('PUT', `/loyaltyClass/${body.id}`, body);
      if (updated.status >= 300) throw new Error(`Google Wallet class update failed: ${updated.status} ${JSON.stringify(updated.data)}`);
    } else if (inserted.status >= 300) {
      throw new Error(`Google Wallet class insert failed: ${inserted.status} ${JSON.stringify(inserted.data)}`);
    }
  }

  async getSaveUrl(store: Store, membership: Membership, user: User) {
    await this.upsertStoreCard(store);

    const object = {
      id: this.objectId(membership),
      classId: this.classId(store),
      state: 'ACTIVE',
      accountName: user.name || user.email,
      ...(await this.progressFields(store, membership)),
    };
    const inserted = await this.writeObject('POST', '/loyaltyObject', object);
    if (inserted.status === 409) {
      await this.updateBalance(store, membership);
    } else if (inserted.status >= 300) {
      throw new Error(`Google Wallet object insert failed: ${inserted.status} ${JSON.stringify(inserted.data)}`);
    }
    if (membership.googleObjectId !== object.id) {
      await prisma.membership.update({ where: { id: membership.id }, data: { googleObjectId: object.id } });
    }

    const token = jwt.sign(
      {
        iss: this.cfg.clientEmail,
        aud: 'google',
        typ: 'savetowallet',
        origins: [config.publicUrl],
        payload: { loyaltyObjects: [{ id: object.id, classId: object.classId }] },
      },
      this.cfg.privateKey,
      { algorithm: 'RS256' },
    );
    return `https://pay.google.com/gp/v/save/${token}`;
  }

  async updateBalance(store: Store, membership: Membership) {
    const res = await this.writeObject('PATCH', `/loyaltyObject/${this.objectId(membership)}`, await this.progressFields(store, membership));
    // 404: the card was never created, so there's nothing to update.
    if (res.status === 404) return false;
    if (res.status >= 300) {
      throw new Error(`Google Wallet balance update failed: ${res.status} ${JSON.stringify(res.data)}`);
    }
    // hasUsers: Google's flag for "someone has saved this card to their wallet".
    // The PATCH response leaves it out, so read the object back when it's missing.
    if (typeof res.data?.hasUsers === 'boolean') return res.data.hasUsers;
    const current = await this.call('GET', `/loyaltyObject/${this.objectId(membership)}`);
    return current.status < 300 && current.data?.hasUsers === true;
  }

  async notify(membership: Membership, header: string, body: string) {
    // TEXT_AND_NOTIFY shows a phone notification; Google allows about 3 per card per day
    // and drops the rest silently, while the message still lands in the card's details.
    const res = await this.call('POST', `/loyaltyObject/${this.objectId(membership)}/addMessage`, {
      message: { id: `m${Date.now()}`, header, body, messageType: 'TEXT_AND_NOTIFY' },
    });
    if (res.status >= 300 && res.status !== 404) {
      throw new Error(`Google Wallet message failed: ${res.status} ${JSON.stringify(res.data)}`);
    }
  }

  async removeCard(membership: Membership) {
    const res = await this.call('PATCH', `/loyaltyObject/${this.objectId(membership)}`, { state: 'INACTIVE' });
    if (res.status >= 300 && res.status !== 404) {
      throw new Error(`Google Wallet card removal failed: ${res.status} ${JSON.stringify(res.data)}`);
    }
  }
}
