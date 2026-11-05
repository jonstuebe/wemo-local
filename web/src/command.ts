import { Data, Effect, Option, Schema } from 'effect'
import {
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from 'effect/http'
import { Command, Http } from 'foldkit'

import { CrockPotMode, Device, Service } from './domain'
import { Message } from './message'

// NOTE: FastAPI reports failures as `{ "detail": "..." }`.
const ApiError = Schema.Struct({ detail: Schema.String })

class ApiFailure extends Data.TaggedError('ApiFailure')<{
  readonly reason: string
}> {}

const describeError = (error: unknown): string =>
  error instanceof ApiFailure
    ? error.reason
    : 'Could not reach the WeMo server. Is `uv run wemo serve` running?'

const decodeResponse =
  <A>(schema: Schema.Decoder<A>) =>
  (response: HttpClientResponse.HttpClientResponse) =>
    Effect.gen(function* () {
      const json = yield* response.json
      if (response.status >= 400) {
        const reason = Option.match(
          Schema.decodeUnknownOption(ApiError)(json),
          {
            onNone: () => `Request failed (${response.status})`,
            onSome: ({ detail }) => detail,
          },
        )
        return yield* Effect.fail(new ApiFailure({ reason }))
      }
      return yield* Schema.decodeEffect(schema)(json)
    })

const getJson = <A>(url: string, schema: Schema.Decoder<A>) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const response = yield* client.get(url)
    return yield* decodeResponse(schema)(response)
  })

const postJson = <A>(url: string, body: unknown, schema: Schema.Decoder<A>) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const request = HttpClientRequest.post(url).pipe(
      HttpClientRequest.bodyJsonUnsafe(body),
    )
    const response = yield* client.execute(request)
    return yield* decodeResponse(schema)(response)
  })

const deviceUrl = (deviceId: string, action: string): string =>
  `/api/devices/${encodeURIComponent(deviceId)}/${action}`

const Devices = Schema.Array(Device)

export const FetchDevices = Command.define('FetchDevices', {
  messages: [Message.SucceededFetchDevices, Message.FailedFetchDevices],
  execute: getJson('/api/devices', Devices).pipe(
    Effect.map(devices => Message.SucceededFetchDevices({ devices })),
    Effect.catch(error =>
      Effect.succeed(
        Message.FailedFetchDevices({ error: describeError(error) }),
      ),
    ),
    Effect.provide(Http.layer),
  ),
})

export const ScanDevices = Command.define('ScanDevices', {
  messages: [Message.SucceededScanDevices, Message.FailedScanDevices],
  execute: postJson('/api/scan', {}, Devices).pipe(
    Effect.map(devices => Message.SucceededScanDevices({ devices })),
    Effect.catch(error =>
      Effect.succeed(
        Message.FailedScanDevices({ error: describeError(error) }),
      ),
    ),
    Effect.provide(Http.layer),
  ),
})

const deviceAction = (deviceId: string, action: string, body: unknown) =>
  postJson(deviceUrl(deviceId, action), body, Device).pipe(
    Effect.map(device => Message.SucceededDeviceAction({ device })),
    Effect.catch(error =>
      Effect.succeed(
        Message.FailedDeviceAction({ deviceId, error: describeError(error) }),
      ),
    ),
    Effect.provide(Http.layer),
  )

const deviceActionMessages = [
  Message.SucceededDeviceAction,
  Message.FailedDeviceAction,
] as const

export const SetPower = Command.define('SetPower', {
  args: { deviceId: Schema.String, isOn: Schema.Boolean },
  messages: deviceActionMessages,
  execute: ({ deviceId, isOn }) => deviceAction(deviceId, 'power', { isOn }),
})

export const SetBrightness = Command.define('SetBrightness', {
  args: { deviceId: Schema.String, level: Schema.Number },
  messages: deviceActionMessages,
  execute: ({ deviceId, level }) =>
    deviceAction(deviceId, 'brightness', { level }),
})

export const SetCookMode = Command.define('SetCookMode', {
  args: {
    deviceId: Schema.String,
    mode: CrockPotMode,
    minutes: Schema.Number,
  },
  messages: deviceActionMessages,
  execute: ({ deviceId, mode, minutes }) =>
    deviceAction(deviceId, 'cook', { mode, minutes }),
})

export const FetchInfo = Command.define('FetchInfo', {
  args: { deviceId: Schema.String },
  messages: [Message.SucceededFetchInfo, Message.FailedFetchInfo],
  execute: ({ deviceId }) =>
    getJson(deviceUrl(deviceId, 'info'), Schema.Array(Service)).pipe(
      Effect.map(services =>
        Message.SucceededFetchInfo({ deviceId, services }),
      ),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedFetchInfo({ deviceId, error: describeError(error) }),
        ),
      ),
      Effect.provide(Http.layer),
    ),
})

const WifiResult = Schema.Struct({
  status: Schema.String,
  message: Schema.String,
})

export const SetupWifi = Command.define('SetupWifi', {
  args: { ssid: Schema.String, password: Schema.String, host: Schema.String },
  messages: [Message.SucceededSetupWifi, Message.FailedSetupWifi],
  execute: ({ ssid, password, host }) =>
    postJson('/api/setup-wifi', { ssid, password, host }, WifiResult).pipe(
      Effect.map(result => Message.SucceededSetupWifi(result)),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedSetupWifi({ error: describeError(error) }),
        ),
      ),
      Effect.provide(Http.layer),
    ),
})
