import "server-only"

import { AsyncLocalStorage } from "node:async_hooks"
import type { ApiProvider } from "@/lib/api-config"

export interface ExternalApiConfig {
  baseUrl: string
  endpointParams?: Record<string, string>
  token: string
  secretValues: string[]
  extraHeaders?: Record<string, string>
  authScheme: "header"
  authHeaderName: string
}

export interface ExternalApiStatus {
  baseUrlConfigured: boolean
  tokenConfigured: boolean
  companyIdConfigured?: boolean
}

export interface ExternalApiConfigOverrides {
  vestiApiBaseUrl?: string
  vestiApiToken?: string
  vestiApiTokenHeaderName?: string
  vestiCompanyId?: string
  upzeroApiBaseUrl?: string
  upzeroApiToken?: string
  requireExplicitCredentials?: boolean
}

const overrideStorage = new AsyncLocalStorage<ExternalApiConfigOverrides>()

const CONFIG_BY_PROVIDER: Record<
  ApiProvider,
  { baseUrlEnv: string; tokenEnv: string }
> = {
  vesti: {
    baseUrlEnv: "VESTI_API_BASE_URL",
    tokenEnv: "VESTI_API_TOKEN",
  },
  upzero: {
    baseUrlEnv: "UPZERO_API_BASE_URL",
    tokenEnv: "UPZERO_API_TOKEN",
  },
}

function envValue(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback
}

function overrideValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function configuredValue(
  value: unknown,
  fallback: string,
  requireExplicitCredentials: boolean | undefined,
): string {
  if (requireExplicitCredentials) {
    return typeof value === "string" ? value.trim() : ""
  }

  return overrideValue(value, fallback)
}

export function withExternalApiConfigOverrides<T>(
  overrides: ExternalApiConfigOverrides | undefined,
  fn: () => T,
) {
  return overrideStorage.run(overrides ?? {}, fn)
}

export function getExternalApiConfig(provider: ApiProvider): ExternalApiConfig {
  const env = CONFIG_BY_PROVIDER[provider]
  const overrides = overrideStorage.getStore() ?? {}
  const requireExplicitCredentials = overrides.requireExplicitCredentials
  const token =
    provider === "vesti"
      ? configuredValue(overrides.vestiApiToken, envValue(env.tokenEnv), requireExplicitCredentials)
      : configuredValue(overrides.upzeroApiToken, envValue(env.tokenEnv), requireExplicitCredentials)

  if (provider === "vesti") {
    const companyId = configuredValue(
      overrides.vestiCompanyId,
      envValue("VESTI_COMPANY_ID"),
      requireExplicitCredentials,
    )
    const companyIdHeader = envValue("VESTI_COMPANY_ID_HEADER_NAME")
    const tokenHeaderName = overrideValue(
      overrides.vestiApiTokenHeaderName,
      envValue("VESTI_API_TOKEN_HEADER_NAME", "apikey"),
    )

    return {
      baseUrl: configuredValue(
        overrides.vestiApiBaseUrl,
        envValue(env.baseUrlEnv),
        requireExplicitCredentials,
      ),
      endpointParams: companyId
        ? {
            company_id: companyId,
            companyId: companyId,
          }
        : undefined,
      token,
      secretValues: [token, companyId].filter(Boolean),
      extraHeaders: companyId && companyIdHeader ? { [companyIdHeader]: companyId } : undefined,
      authScheme: "header",
      authHeaderName: tokenHeaderName || "apikey",
    }
  }

  return {
    baseUrl: configuredValue(
      overrides.upzeroApiBaseUrl,
      envValue(env.baseUrlEnv),
      requireExplicitCredentials,
    ),
    token,
    secretValues: [token].filter(Boolean),
    authScheme: "header",
    authHeaderName: envValue("UPZERO_API_TOKEN_HEADER_NAME", "X-API-KEY"),
  }
}

export function getExternalApiStatus(provider: ApiProvider): ExternalApiStatus {
  const config = getExternalApiConfig(provider)

  return {
    baseUrlConfigured: Boolean(config.baseUrl),
    tokenConfigured: Boolean(config.token),
    companyIdConfigured:
      provider === "vesti" ? Boolean(envValue("VESTI_COMPANY_ID")) : undefined,
  }
}
