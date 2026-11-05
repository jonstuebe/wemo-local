import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { CrockPotMode, Device, Service } from './domain'

export const Message = defineMessageUnion({
  TickedRefresh: {},
  SucceededFetchDevices: { devices: Schema.Array(Device) },
  FailedFetchDevices: { error: Schema.String },

  ClickedRescan: {},
  SucceededScanDevices: { devices: Schema.Array(Device) },
  FailedScanDevices: { error: Schema.String },

  ClickedPower: { deviceId: Schema.String, isOn: Schema.Boolean },
  ChangedBrightness: { deviceId: Schema.String, level: Schema.Number },
  SelectedCookMinutes: { deviceId: Schema.String, minutes: Schema.Number },
  ClickedCookMode: { deviceId: Schema.String, mode: CrockPotMode },
  SucceededDeviceAction: { device: Device },
  FailedDeviceAction: { deviceId: Schema.String, error: Schema.String },
  ClickedDismissError: {},

  ClickedShowInfo: { deviceId: Schema.String },
  ClickedHideInfo: {},
  SucceededFetchInfo: {
    deviceId: Schema.String,
    services: Schema.Array(Service),
  },
  FailedFetchInfo: { deviceId: Schema.String, error: Schema.String },

  UpdatedWifiSsid: { value: Schema.String },
  UpdatedWifiPassword: { value: Schema.String },
  UpdatedWifiHost: { value: Schema.String },
  SubmittedWifiForm: {},
  SucceededSetupWifi: { status: Schema.String, message: Schema.String },
  FailedSetupWifi: { error: Schema.String },
})
export type Message = typeof Message.Type
