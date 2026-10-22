import app from './hono/webs';
import { email } from './email/email';
import userService from './service/user-service';
import verifyRecordService from './service/verify-record-service';
import emailService from './service/email-service';
import kvObjService from './service/kv-obj-service';
import oauthService from './service/oauth-service';
import analysisService from './service/analysis-service';
import { handlePortalOtpLog, PATH as PORTAL_OTP_LOG_PATH } from './service/portal-otp-log-service';

export function normalizeBindings(env) {
	if (env?.r2 || !env?.R2) return env;
	return { ...env, r2: env.R2 };
}
export default {
	 async fetch(req, env, ctx) {

			const url = new URL(req.url)
			const runtimeEnv = normalizeBindings(env);
			if (url.pathname === PORTAL_OTP_LOG_PATH) {
				return handlePortalOtpLog(req, runtimeEnv);
			}

		if (url.pathname.startsWith('/api/')) {
			url.pathname = url.pathname.replace('/api', '')
			req = new Request(url.toString(), req)
				return app.fetch(req, runtimeEnv, ctx);
		}

		 if (['/static/','/attachments/'].some(p => url.pathname.startsWith(p))) {
				 return await kvObjService.toObjResp( { env: runtimeEnv }, url.pathname.substring(1));
		 }

			return runtimeEnv.assets.fetch(req);
		},
		email: (message, env, ctx) => email(message, normalizeBindings(env), ctx),
		async scheduled(c, env, ctx) {
			const runtimeEnv = normalizeBindings(env);
			if (c.cron === '*/30 * * * *') {
				await analysisService.refreshEchartsCache({ env: runtimeEnv })
			return;
		}

			await verifyRecordService.clearRecord({ env: runtimeEnv })
			await userService.resetDaySendCount({ env: runtimeEnv })
			await emailService.completeReceiveAll({ env: runtimeEnv })
			await emailService.autoClean({ env: runtimeEnv })
			await analysisService.refreshEchartsCache({ env: runtimeEnv })
			await oauthService.clearNoBindOathUser({ env: runtimeEnv })
	},
};
