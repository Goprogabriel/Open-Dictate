import { Check, Cpu, ExternalLink, KeyRound, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { PageFrame } from "@/components/layout/PageFrame";
import { PageHeader } from "@/components/layout/PageHeader";
import { SettingRow, SettingsGroup } from "@/components/layout/SettingsGroup";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { ShortcutKeycaps } from "@/components/ui/ShortcutKeycaps";
import { Switch } from "@/components/ui/Switch";
import { ApiKeyDialog } from "@/features/settings/ApiKeyDialog";
import { LocalAiSetup } from "@/features/settings/LocalAiSetup";
import { changeLocale } from "@/locales";
import { authService } from "@/services/firebase/authService";
import { nativeClient } from "@/services/native";
import { secureSecretService } from "@/services/secureSecretService";
import { clearSecureStateScope, switchSecureStateScope } from "@/services/secureStateService";
import { useHistoryStore } from "@/stores/historyStore";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUsageStore } from "@/stores/usageStore";
import type { Locale, PermissionSnapshot } from "@/types/domain";
import type { MicrophoneDevice } from "@/types/native";

const unknownPermissions: PermissionSnapshot = {
  microphone: "unknown",
  accessibility: "unknown",
  screenRecording: "unknown",
};

function permissionTone(state: PermissionSnapshot[keyof PermissionSnapshot]) {
  if (state === "granted") return "success" as const;
  if (state === "denied" || state === "restricted") return "danger" as const;
  return "neutral" as const;
}

export function SettingsPage() {
  const { t } = useTranslation();
  const profile = useSessionStore((state) => state.profile);
  const signOutLocal = useSessionStore((state) => state.signOut);
  const resetOnboarding = useOnboardingStore((state) => state.reset);
  const locale = usePreferencesStore((state) => state.locale);
  const transcriptionLanguage = usePreferencesStore((state) => state.transcriptionLanguage);
  const microphoneId = usePreferencesStore((state) => state.microphoneId);
  const launchAtStartup = usePreferencesStore((state) => state.launchAtStartup);
  const runInBackground = usePreferencesStore((state) => state.runInBackground);
  const privacy = usePreferencesStore((state) => state.privacy);
  const processingMode = usePreferencesStore((state) => state.processingMode);
  const setLocale = usePreferencesStore((state) => state.setLocale);
  const setTranscriptionLanguage = usePreferencesStore((state) => state.setTranscriptionLanguage);
  const setMicrophone = usePreferencesStore((state) => state.setMicrophone);
  const setLaunchAtStartup = usePreferencesStore((state) => state.setLaunchAtStartup);
  const setRunInBackground = usePreferencesStore((state) => state.setRunInBackground);
  const setPrivacy = usePreferencesStore((state) => state.setPrivacy);
  const setProcessingMode = usePreferencesStore((state) => state.setProcessingMode);
  const resetPreferences = usePreferencesStore((state) => state.reset);
  const clearHistory = useHistoryStore((state) => state.clear);
  const resetUsage = useUsageStore((state) => state.reset);
  const [permissions, setPermissions] = useState(unknownPermissions);
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [apiKeyPresent, setApiKeyPresent] = useState(false);
  const [apiDialogOpen, setApiDialogOpen] = useState(false);
  const [removeKeyOpen, setRemoveKeyOpen] = useState(false);
  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [localSetupOpen, setLocalSetupOpen] = useState(false);
  const [uninstallModelsOpen, setUninstallModelsOpen] = useState(false);
  const [uninstallModelsBusy, setUninstallModelsBusy] = useState(false);
  const isLocalProfile = profile.email === null;
  const configureLocalUser = useSessionStore((state) => state.configureLocalUser);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      nativeClient.getPermissions(),
      nativeClient.listMicrophones(),
      secureSecretService.hasOpenAiKey(),
    ]).then(([permissionResult, microphoneResult, keyResult]) => {
      if (!active) return;
      if (permissionResult.status === "fulfilled") setPermissions(permissionResult.value);
      if (microphoneResult.status === "fulfilled") setMicrophones(microphoneResult.value);
      if (keyResult.status === "fulfilled") setApiKeyPresent(keyResult.value);
    });
    return () => {
      active = false;
    };
  }, []);

  const updateAutostart = async (enabled: boolean) => {
    setLaunchAtStartup(enabled);
    try {
      await nativeClient.setAutostartEnabled(enabled);
    } catch {
      setLaunchAtStartup(!enabled);
    }
  };

  const updateRunInBackground = async (enabled: boolean) => {
    setRunInBackground(enabled);
    try {
      await nativeClient.setRunInBackground(enabled);
    } catch {
      setRunInBackground(!enabled);
    }
  };

  const removeKey = async () => {
    await secureSecretService.deleteOpenAiKey();
    setApiKeyPresent(false);
    setRemoveKeyOpen(false);
  };

  const activateOwnKey = () => {
    if (!apiKeyPresent) {
      setApiDialogOpen(true);
      return;
    }
    setProcessingMode("free");
    if (isLocalProfile) configureLocalUser("", "free");
  };

  const uninstallModels = async () => {
    setUninstallModelsBusy(true);
    try {
      await nativeClient.uninstallLocalModels();
      if (processingMode === "local") {
        setProcessingMode("free");
        if (isLocalProfile) configureLocalUser("", "free");
      }
      setUninstallModelsOpen(false);
    } finally {
      setUninstallModelsBusy(false);
    }
  };

  const signOut = async () => {
    setSignOutBusy(true);
    setSignOutFailed(false);
    try {
      await nativeClient.uninstallLocalModels();
      await authService.signOut();
      if (isLocalProfile) {
        await secureSecretService.deleteOpenAiKey();
        await clearSecureStateScope(null);
        resetPreferences();
        resetUsage();
        setApiKeyPresent(false);
        void changeLocale("en");
        void nativeClient.setAutostartEnabled(false).catch(() => undefined);
        void nativeClient.setRunInBackground(true).catch(() => undefined);
      } else {
        await switchSecureStateScope(null);
      }
      signOutLocal();
      resetOnboarding();
      setSignOutOpen(false);
    } catch {
      setSignOutFailed(true);
    } finally {
      setSignOutBusy(false);
    }
  };

  const permissionLabel = (state: PermissionSnapshot[keyof PermissionSnapshot]) => {
    if (state === "granted") return t("settings.permissions.statusGranted");
    if (state === "denied" || state === "restricted") return t("settings.permissions.statusDenied");
    return t("settings.permissions.statusUnknown");
  };

  return (
    <PageFrame>
      <PageHeader title={t("settings.title")} description={t("settings.subtitle")} />

      <div className="space-y-8">
        <SettingsGroup title={t("settings.general.title")}>
          <SettingRow
            title={t("settings.general.interfaceLanguage")}
            description={t("settings.general.interfaceLanguageDescription")}
          >
            <Select
              aria-label={t("settings.general.interfaceLanguage")}
              value={locale}
              onChange={(event) => {
                const nextLocale = event.target.value as Locale;
                setLocale(nextLocale);
                void changeLocale(nextLocale);
              }}
              className="w-[155px]"
            >
              {(["en", "da", "no", "sv"] as Locale[]).map((language) => (
                <option key={language} value={language}>
                  {t(`languages.${language}`)}
                </option>
              ))}
            </Select>
          </SettingRow>
          <SettingRow
            title={t("settings.general.launchAtStartup")}
            description={t("settings.general.launchAtStartupDescription")}
          >
            <Switch
              checked={launchAtStartup}
              onCheckedChange={(enabled) => void updateAutostart(enabled)}
              label={t("settings.general.launchAtStartup")}
            />
          </SettingRow>
          <SettingRow
            title={t("settings.general.runInBackground")}
            description={t("settings.general.runInBackgroundDescription")}
          >
            <Switch
              checked={runInBackground}
              onCheckedChange={(enabled) => void updateRunInBackground(enabled)}
              label={t("settings.general.runInBackground")}
            />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title={t("settings.dictation.title")}>
          <SettingRow
            title={t("settings.dictation.shortcut")}
            description={t("settings.dictation.shortcutDescription")}
          >
            <ShortcutKeycaps />
          </SettingRow>
          <SettingRow
            title={t("settings.dictation.microphone")}
            description={t("settings.dictation.microphoneDescription")}
          >
            <Select
              aria-label={t("settings.dictation.microphone")}
              value={microphoneId ?? "default"}
              onChange={(event) =>
                setMicrophone(event.target.value === "default" ? null : event.target.value)
              }
              className="w-[210px]"
            >
              <option value="default">{t("settings.dictation.systemDefault")}</option>
              {microphones.map((microphone) => (
                <option key={microphone.id} value={microphone.id}>
                  {microphone.name}
                </option>
              ))}
            </Select>
          </SettingRow>
          <SettingRow
            title={t("settings.dictation.transcriptionLanguage")}
            description={t("settings.dictation.transcriptionLanguageDescription")}
          >
            <Select
              aria-label={t("settings.dictation.transcriptionLanguage")}
              value={transcriptionLanguage}
              onChange={(event) => setTranscriptionLanguage(event.target.value as Locale)}
              className="w-[155px]"
            >
              {(["en", "da", "no", "sv"] as Locale[]).map((language) => (
                <option key={language} value={language}>
                  {t(`languages.${language}`)}
                </option>
              ))}
            </Select>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title={t("settings.ai.title")} description={t("settings.ai.description")}>
          <SettingRow
            title={t("settings.ai.currentPlan")}
            description={t(`settings.ai.mode.${processingMode}Description`)}
          >
            <Badge tone="success">{t(`settings.ai.mode.${processingMode}`)}</Badge>
          </SettingRow>
          <SettingRow
            title={t("settings.ai.switchPlan")}
            description={t("settings.ai.switchPlanDescription")}
          >
            <Button
              variant={processingMode === "free" ? "primary" : "secondary"}
              size="sm"
              onClick={activateOwnKey}
            >
              <KeyRound className="size-3.5" />
              {t("settings.ai.mode.free")}
            </Button>
            <Button
              variant={processingMode === "local" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setLocalSetupOpen(true)}
            >
              <Cpu className="size-3.5" />
              {t("settings.ai.mode.local")}
            </Button>
            <Button
              variant={processingMode === "pro" ? "primary" : "secondary"}
              size="sm"
              onClick={resetOnboarding}
            >
              <Sparkles className="size-3.5" />
              {t("settings.ai.mode.pro")}
            </Button>
          </SettingRow>
          <SettingRow
            title={t("settings.ai.uninstallTitle")}
            description={t("settings.ai.uninstallDescription")}
          >
            <Button variant="danger" size="sm" onClick={() => setUninstallModelsOpen(true)}>
              <Trash2 className="size-3.5" />
              {t("settings.ai.uninstall")}
            </Button>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title={t("settings.api.title")}>
          {processingMode === "pro" ? (
            <SettingRow
              title={t("settings.api.managedTitle")}
              description={t("settings.api.managedDescription")}
            >
              <Badge tone="success">
                <ShieldCheck className="mr-1 size-3" />
                {t("common.states.connected")}
              </Badge>
            </SettingRow>
          ) : (
            <SettingRow
              title={t("settings.api.keyTitle")}
              description={t("settings.api.keyDescription")}
            >
              {apiKeyPresent ? (
                <>
                  <Badge tone="success">
                    <Check className="mr-1 size-3" />
                    {t("settings.api.keyConnected")}
                  </Badge>
                  <Button variant="secondary" size="sm" onClick={() => setApiDialogOpen(true)}>
                    {t("common.actions.replace")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRemoveKeyOpen(true)}>
                    {t("common.actions.remove")}
                  </Button>
                </>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setApiDialogOpen(true)}>
                  <KeyRound className="size-3.5" />
                  {t("common.actions.add")}
                </Button>
              )}
            </SettingRow>
          )}
        </SettingsGroup>

        <SettingsGroup
          title={t("settings.permissions.title")}
          description={t("settings.permissions.description")}
        >
          {(["microphone", "accessibility"] as const).map((kind) => (
            <SettingRow
              key={kind}
              title={t(`settings.permissions.${kind}`)}
              description={t(`settings.permissions.${kind}Description`)}
            >
              <Badge tone={permissionTone(permissions[kind])}>
                {permissionLabel(permissions[kind])}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void nativeClient.openPermissionSettings(kind)}
              >
                <ExternalLink className="size-3.5" />
                {t("settings.permissions.openSystemSettings")}
              </Button>
            </SettingRow>
          ))}
          <SettingRow
            title={t("settings.permissions.screenRecording")}
            description={t("settings.permissions.screenRecordingDescription")}
          >
            <Badge>{t("permissions.states.optional")}</Badge>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title={t("settings.privacy.title")}>
          <SettingRow
            title={t("settings.privacy.saveHistory")}
            description={t("settings.privacy.saveHistoryDescription")}
          >
            <Switch
              checked={privacy.saveHistory}
              onCheckedChange={(saveHistory) => setPrivacy({ saveHistory })}
              label={t("settings.privacy.saveHistory")}
            />
          </SettingRow>
          <SettingRow
            title={t("settings.privacy.retention")}
            description={t("settings.privacy.retentionDescription")}
          >
            <Select
              aria-label={t("settings.privacy.retention")}
              value={privacy.retentionDays}
              onChange={(event) =>
                setPrivacy({
                  retentionDays: Number(event.target.value) as 7 | 30 | 90 | 365,
                })
              }
              className="w-[145px]"
            >
              <option value={7}>{t("settings.privacy.retention7")}</option>
              <option value={30}>{t("settings.privacy.retention30")}</option>
              <option value={90}>{t("settings.privacy.retention90")}</option>
              <option value={365}>{t("settings.privacy.retention365")}</option>
            </Select>
          </SettingRow>
          <SettingRow
            title={t("settings.privacy.analytics")}
            description={t("settings.privacy.analyticsDescription")}
          >
            <Switch
              checked={privacy.shareDiagnostics}
              onCheckedChange={(shareDiagnostics) => setPrivacy({ shareDiagnostics })}
              label={t("settings.privacy.analytics")}
            />
          </SettingRow>
          <SettingRow
            title={t("settings.privacy.clearCache")}
            description={t("settings.privacy.clearCacheDescription")}
          >
            <Button variant="secondary" size="sm" onClick={() => setClearCacheOpen(true)}>
              {t("settings.privacy.clearCache")}
            </Button>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title={t("settings.session.title")}>
          <SettingRow
            title={
              isLocalProfile
                ? t("settings.session.localProfile")
                : t("settings.session.signedInAs", { email: profile.email })
            }
            description={isLocalProfile ? t("settings.session.localProfileDescription") : undefined}
          >
            <Button variant="secondary" size="sm" onClick={() => setSignOutOpen(true)}>
              {t("settings.session.signOut")}
            </Button>
          </SettingRow>
        </SettingsGroup>
      </div>

      <ApiKeyDialog
        open={apiDialogOpen}
        onClose={() => setApiDialogOpen(false)}
        onSaved={() => {
          setApiKeyPresent(true);
          setProcessingMode("free");
          if (isLocalProfile) configureLocalUser("", "free");
        }}
      />
      <Dialog
        open={localSetupOpen}
        onClose={() => setLocalSetupOpen(false)}
        title={t("settings.ai.localSetupTitle")}
        description={t("settings.ai.localSetupDescription")}
      >
        <LocalAiSetup onReady={() => setLocalSetupOpen(false)} />
      </Dialog>
      <Dialog
        open={uninstallModelsOpen}
        onClose={() => {
          if (!uninstallModelsBusy) setUninstallModelsOpen(false);
        }}
        title={t("settings.ai.uninstallTitle")}
        description={t("settings.ai.uninstallConfirmDescription")}
      >
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            disabled={uninstallModelsBusy}
            onClick={() => setUninstallModelsOpen(false)}
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="danger"
            loading={uninstallModelsBusy}
            onClick={() => void uninstallModels()}
          >
            {t("settings.ai.uninstall")}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={removeKeyOpen}
        onClose={() => setRemoveKeyOpen(false)}
        title={t("settings.api.removeTitle")}
        description={t("settings.api.removeDescription")}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRemoveKeyOpen(false)}>
            {t("common.actions.cancel")}
          </Button>
          <Button variant="danger" onClick={() => void removeKey()}>
            {t("settings.api.removeKey")}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={clearCacheOpen}
        onClose={() => setClearCacheOpen(false)}
        title={t("settings.privacy.clearCacheTitle")}
        description={t("settings.privacy.clearCacheDescription")}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setClearCacheOpen(false)}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              clearHistory();
              setClearCacheOpen(false);
            }}
          >
            {t("settings.privacy.clearCacheConfirm")}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={signOutOpen}
        onClose={() => {
          if (!signOutBusy) setSignOutOpen(false);
        }}
        title={t(
          isLocalProfile ? "settings.session.localSignOutTitle" : "settings.session.signOutTitle",
        )}
        description={t(
          isLocalProfile
            ? "settings.session.localSignOutDescription"
            : "settings.session.signOutDescription",
        )}
      >
        {signOutFailed ? (
          <p className="mb-4 text-xs font-medium text-danger" role="alert">
            {t("common.states.error")}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={signOutBusy} onClick={() => setSignOutOpen(false)}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant={isLocalProfile ? "danger" : "primary"}
            loading={signOutBusy}
            onClick={() => void signOut()}
          >
            {t(
              isLocalProfile ? "settings.session.localSignOutConfirm" : "settings.session.signOut",
            )}
          </Button>
        </div>
      </Dialog>
    </PageFrame>
  );
}
