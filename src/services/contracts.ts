import type {
  BillingInvoice,
  Dictation,
  DictionaryRecord,
  RemoteTransformationSettings,
  Subscription,
  TopupTierId,
  TransformationSettings,
  TransformationSettingsRecord,
  UsageSummary,
  UserProfile,
} from "@/types/domain";

export interface AuthSession {
  user: UserProfile;
  emailVerified: boolean;
  getIdToken(forceRefresh?: boolean): Promise<string>;
  refresh(): Promise<AuthSession>;
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

export interface AuthService {
  observe(listener: (session: AuthSession | null) => void): () => void;
  signUp(input: SignUpInput): Promise<AuthSession>;
  signIn(email: string, password: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  sendVerificationEmail(): Promise<AuthSession>;
  sendPasswordReset(email: string): Promise<void>;
}

export interface BillingService {
  createCheckoutSession(): Promise<string>;
  createTopupSession(tier: TopupTierId): Promise<string>;
  createPortalSession(): Promise<string>;
  getSubscription(): Promise<Subscription>;
  listInvoices(): Promise<BillingInvoice[]>;
}

export interface HistoryRepository {
  list(): Promise<Dictation[]>;
  save(dictation: Dictation): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface DictionaryRepository {
  list(): Promise<DictionaryRecord[]>;
  save(record: DictionaryRecord): Promise<DictionaryRecord>;
}

export interface SettingsRepository {
  getTransformationSettings(): Promise<RemoteTransformationSettings>;
  saveTransformationSettings(
    settings: TransformationSettings,
  ): Promise<TransformationSettingsRecord>;
}

export interface UsageRepository {
  getMonth(month: string): Promise<UsageSummary>;
}
