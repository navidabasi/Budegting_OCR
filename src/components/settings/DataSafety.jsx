import { useRef, useState } from 'react';
import { Download, HardDrive, RefreshCw, ShieldCheck, Upload } from 'lucide-react';
import Button from '../common/Button';
import SettingsCard from '../common/SettingsCard';
import { Sheet } from '../ui';
import RecordSyncBadge from '../sync/RecordSyncBadge';
import { useStorageEstimate, useSyncQueue } from '../../data/syncHooks';
import { requestPersistentStorage, formatBytes } from '../../data/storage';
import { backupFileName, exportBackup, parseBackup, previewRestore, restoreBackup } from '../../data/backup';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../languages/useTranslation';

function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Settings > Data: sync status with "Retry now", storage on this device (persistent storage), JSON backup and restore. */
export default function DataSafety() {
    const { t, languageCode } = useTranslation();
    const userId = useAppStore((s) => s.currentUser?.userId);
    const showToast = useAppStore((s) => s.showToast);
    const { summary, online, syncing, lastSyncAt, retryNow } = useSyncQueue();
    const { info, refresh } = useStorageEstimate();
    const [includePhotos, setIncludePhotos] = useState(false);
    const [busy, setBusy] = useState(null); // 'sync' | 'export' | 'restore'
    const [persistDenied, setPersistDenied] = useState(false);
    const [restorePlan, setRestorePlan] = useState(null); // { backup, preview, otherAccount }
    const fileRef = useRef(null);

    const when = lastSyncAt ? new Intl.DateTimeFormat(languageCode, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(lastSyncAt)) : null;

    const doExport = async () => {
        setBusy('export');
        try {
            const backup = await exportBackup(userId, { includeImages: includePhotos });
            download(backupFileName(), JSON.stringify(backup));
            showToast(t('backup.exported'), 'success');
            if (backup.imagesMissing) showToast(t('backup.photosMissing', { count: backup.imagesMissing }), 'warning');
        } catch (err) {
            console.error('[Backup] export failed', err);
            showToast(t('backup.exportFailed'), 'error');
        } finally {
            setBusy(null);
        }
    };

    const onFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const { backup } = parseBackup(await file.text());
            const preview = await previewRestore(backup, userId);
            setRestorePlan({ backup, preview, otherAccount: !!backup.userId && backup.userId !== userId });
        } catch (err) {
            showToast(err?.message === 'unsupported_backup' ? t('backup.unsupported') : t('backup.invalid'), 'error');
        }
    };

    const doRestore = async () => {
        if (!restorePlan) return;
        setBusy('restore');
        try {
            const r = await restoreBackup(restorePlan.backup, userId);
            const sum = (k) => Object.values(r).reduce((n, x) => n + (x[k] || 0), 0);
            showToast(t('backup.restored', { added: sum('added'), updated: sum('updated') }), 'success');
            setRestorePlan(null);
        } catch (err) {
            console.error('[Backup] restore failed', err);
            showToast(t('backup.invalid'), 'error');
        } finally {
            setBusy(null);
        }
    };

    const totals = restorePlan ? Object.values(restorePlan.preview).reduce((a, x) => ({ added: a.added + x.added, updated: a.updated + x.updated, skipped: a.skipped + x.skipped }), { added: 0, updated: 0, skipped: 0 }) : null;

    return (
        <SettingsCard icon={ShieldCheck} title={t('backup.title')}>
            <div className="space-y-4" data-testid="data-safety">
                <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                        <RecordSyncBadge state={summary.state} size={14} />
                        <span className="text-xs text-gray-500 dark:text-gray-400">{when ? t('sync.lastSync', { time: when }) : t('sync.neverSynced')}</span>
                    </div>
                    {summary.pending > 0 ? <p className="text-xs text-gray-500 dark:text-gray-400">{t('sync.waitingCount', { count: summary.pending })}</p> : null}
                    <Button variant="secondary" disabled={busy === 'sync' || syncing || !online} onClick={async () => { setBusy('sync'); try { await retryNow(); } finally { setBusy(null); } }} className="flex w-full items-center justify-center gap-2">
                        <RefreshCw size={18} className={busy === 'sync' || syncing ? 'animate-spin' : ''} />
                        {busy === 'sync' || syncing ? t('sync.retrying') : t('sync.retryNow')}
                    </Button>
                </div>

                <div className="space-y-2 border-t border-gray-100 pt-4 dark:border-gray-700">
                    <h4 className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                        <HardDrive size={16} aria-hidden="true" />
                        {t('storage.title')}
                    </h4>
                    {info && info.usage !== null ? (
                        <p className="text-sm text-gray-600 dark:text-gray-400" data-testid="storage-usage">
                            {info.quota ? t('storage.used', { used: formatBytes(info.usage), quota: formatBytes(info.quota) }) : t('storage.usedOnly', { used: formatBytes(info.usage) })}
                        </p>
                    ) : (
                        <p className="text-sm text-gray-600 dark:text-gray-400">{t('storage.unsupported')}</p>
                    )}
                    {info?.persisted === true ? <p className="text-xs text-green-700 dark:text-green-400">{t('storage.persisted')}</p> : null}
                    {info?.persisted === false ? (
                        <>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{t('storage.notPersisted')}</p>
                            <Button
                                variant="secondary"
                                className="w-full"
                                onClick={async () => {
                                    const ok = await requestPersistentStorage();
                                    setPersistDenied(ok === false);
                                    refresh();
                                }}
                            >
                                {t('storage.requestPersist')}
                            </Button>
                            {persistDenied ? <p className="text-xs text-gray-500 dark:text-gray-400">{t('storage.persistDenied')}</p> : null}
                        </>
                    ) : null}
                </div>

                <div className="space-y-3 border-t border-gray-100 pt-4 dark:border-gray-700">
                    <p className="text-sm text-gray-600 dark:text-gray-400">{t('backup.note')}</p>
                    <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                        <input type="checkbox" checked={includePhotos} onChange={(e) => setIncludePhotos(e.target.checked)} className="h-5 w-5" />
                        {t('backup.includePhotos')}
                    </label>
                    <Button variant="primary" disabled={busy === 'export'} onClick={doExport} className="flex w-full items-center justify-center gap-2">
                        <Download size={18} />
                        {busy === 'export' ? t('backup.exporting') : t('backup.export')}
                    </Button>
                    <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} data-testid="restore-input" />
                    <Button variant="secondary" onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-2">
                        <Upload size={18} />
                        {t('backup.restore')}
                    </Button>
                </div>
            </div>

            <Sheet open={!!restorePlan} onClose={() => setRestorePlan(null)} label={t('backup.restoreTitle')}>
                <div className="flex flex-col gap-3 px-5 pb-2">
                    <h2 className="font-display text-lg font-bold text-ink">{t('backup.restoreTitle')}</h2>
                    <p className="text-sm text-ink-muted">{t('backup.restoreBody')}</p>
                    {totals ? <p className="text-sm font-medium text-ink">{t('backup.preview', totals)}</p> : null}
                    {restorePlan?.otherAccount ? <p className="rounded-[14px] bg-warn-soft px-3.5 py-3 text-sm text-warn-ink">{t('backup.otherAccount')}</p> : null}
                    <button type="button" disabled={busy === 'restore'} onClick={doRestore} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-50" data-autofocus>
                        {t('backup.restoreConfirm')}
                    </button>
                    <button type="button" onClick={() => setRestorePlan(null)} className="h-12 rounded-[18px] text-sm font-semibold text-ink-muted">
                        {t('common.actions.cancel')}
                    </button>
                </div>
            </Sheet>
        </SettingsCard>
    );
}
