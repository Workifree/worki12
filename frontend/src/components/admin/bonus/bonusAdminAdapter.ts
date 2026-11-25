import { invokeFunction } from '../../../services/api';
import type { BonusAdminAdapter } from './types';

// Adaptador de produção: toda operação privilegiada passa pela edge function `admin-data`
// (checagem de admin própria, service_role só no servidor — Article 10).
export const edgeBonusAdminAdapter: BonusAdminAdapter = {
    async getReviewQueue() {
        const r = await invokeFunction<{ items: Awaited<ReturnType<BonusAdminAdapter['getReviewQueue']>> }>('admin-data', { action: 'bonus_review_queue' });
        return r.items;
    },
    async decideReview(ledgerId, decision) {
        await invokeFunction('admin-data', { action: 'bonus_decide', ledgerId, decision });
    },
    async getPayouts() {
        const r = await invokeFunction<{ items: Awaited<ReturnType<BonusAdminAdapter['getPayouts']>> }>('admin-data', { action: 'bonus_payouts' });
        return r.items;
    },
    async markPayoutPaid(payoutId, note) {
        await invokeFunction('admin-data', { action: 'bonus_mark_paid', payoutId, note });
    },
    async getVetos() {
        const r = await invokeFunction<{ items: Awaited<ReturnType<BonusAdminAdapter['getVetos']>> }>('admin-data', { action: 'bonus_vetos' });
        return r.items;
    },
    async addVeto(personId, reason) {
        await invokeFunction('admin-data', { action: 'bonus_veto_add', personId, reason });
    },
    async removeVeto(personId) {
        await invokeFunction('admin-data', { action: 'bonus_veto_remove', personId });
    },
    async getTracks() {
        const r = await invokeFunction<{ items: Awaited<ReturnType<BonusAdminAdapter['getTracks']>> }>('admin-data', { action: 'bonus_tracks' });
        return r.items;
    },
    async updateTrackParams(trackKey, params) {
        await invokeFunction('admin-data', { action: 'bonus_track_params_update', trackKey, params });
    },
    async getTracking() {
        return invokeFunction<Awaited<ReturnType<BonusAdminAdapter['getTracking']>>>('admin-data', { action: 'bonus_tracking' });
    },
    async getParamsHistory() {
        const r = await invokeFunction<{ items: Awaited<ReturnType<BonusAdminAdapter['getParamsHistory']>> }>('admin-data', { action: 'bonus_params_history' });
        return r.items;
    },
    async getEnrollments() {
        const r = await invokeFunction<{ items: Awaited<ReturnType<BonusAdminAdapter['getEnrollments']>> }>('admin-data', { action: 'bonus_enrollments' });
        return r.items;
    },
    async getProgramEnabled() {
        const r = await invokeFunction<{ enabled: Awaited<ReturnType<BonusAdminAdapter['getProgramEnabled']>> }>('admin-data', { action: 'bonus_settings' });
        return r.enabled;
    },
    async getAlerts() {
        return invokeFunction<Awaited<ReturnType<BonusAdminAdapter['getAlerts']>>>('admin-data', { action: 'bonus_alerts' });
    },
    async createEnrollment(input) {
        await invokeFunction('admin-data', { action: 'bonus_enrollment_create', ...input });
    },
    async registerCompanyAck(enrollmentId, byLabel, note) {
        await invokeFunction('admin-data', { action: 'bonus_enrollment_ack', enrollmentId, byLabel, note });
    },
    async updateTrackStatus(trackKey, status) {
        await invokeFunction('admin-data', { action: 'bonus_track_status_update', trackKey, status });
    },
    async cancelEnrollment(enrollmentId) {
        await invokeFunction('admin-data', { action: 'bonus_enrollment_cancel', enrollmentId });
    },
    async setProgramEnabled(enabled) {
        await invokeFunction('admin-data', { action: 'bonus_set_enabled', enabled });
    },
};
