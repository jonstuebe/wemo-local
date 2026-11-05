import { Option, Record, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { DEFAULT_COOK_MINUTES, Device, Service } from './domain'

// MODEL

export const DeviceList = defineTaggedUnion({
  Loading: {},
  Failed: { error: Schema.String },
  Loaded: { devices: Schema.Array(Device) },
})
export type DeviceList = typeof DeviceList.Type

export const Scan = defineTaggedUnion({ Idle: {}, Scanning: {} })
export type Scan = typeof Scan.Type

export const InfoPanel = defineTaggedUnion({
  Closed: {},
  Loading: { deviceId: Schema.String },
  Failed: { deviceId: Schema.String, error: Schema.String },
  Loaded: { deviceId: Schema.String, services: Schema.Array(Service) },
})
export type InfoPanel = typeof InfoPanel.Type

export const WifiSubmission = defineTaggedUnion({
  NotSubmitted: {},
  Submitting: {},
  Succeeded: { status: Schema.String, message: Schema.String },
  Failed: { error: Schema.String },
})
export type WifiSubmission = typeof WifiSubmission.Type

export const WifiForm = Schema.Struct({
  ssid: Schema.String,
  password: Schema.String,
  host: Schema.String,
  submission: WifiSubmission,
})
export type WifiForm = typeof WifiForm.Type

export const Model = Schema.Struct({
  deviceList: DeviceList,
  scan: Scan,
  pendingDeviceIds: Schema.Array(Schema.String),
  maybeActionError: Schema.Option(Schema.String),
  cookMinutesByDevice: Schema.Record(Schema.String, Schema.Number),
  infoPanel: InfoPanel,
  wifi: WifiForm,
})
export type Model = typeof Model.Type

export const cookMinutesFor = (model: Model, deviceId: string): number =>
  Option.getOrElse(
    Record.get(model.cookMinutesByDevice, deviceId),
    () => DEFAULT_COOK_MINUTES,
  )

export const initialModel: Model = {
  deviceList: DeviceList.Loading(),
  scan: Scan.Idle(),
  pendingDeviceIds: [],
  maybeActionError: Option.none(),
  cookMinutesByDevice: {},
  infoPanel: InfoPanel.Closed(),
  wifi: {
    ssid: '',
    password: '',
    host: '10.22.22.1',
    submission: WifiSubmission.NotSubmitted(),
  },
}
