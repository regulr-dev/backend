import type { Membership, Store, User } from '@prisma/client';

// Every wallet (Google now, Apple later) implements this. The rest of the app
// only talks to src/wallet/index.ts, never to a specific provider.
export interface WalletProvider {
  readonly name: 'google' | 'apple';
  /** Create or update the store's branded card template. */
  upsertStoreCard(store: Store): Promise<void>;
  /** Link the customer opens to save their card into the wallet. */
  getSaveUrl(store: Store, membership: Membership, user: User): Promise<string>;
  /** Push the new stamp balance. Resolves true if the customer has the card saved in their wallet. */
  updateBalance(store: Store, membership: Membership): Promise<boolean>;
  /** Show a notification on the customer's phone and add it to the card's messages. */
  notify(membership: Membership, header: string, body: string): Promise<void>;
  /** Deactivate the customer's card, e.g. when they delete their account. */
  removeCard(membership: Membership): Promise<void>;
}
