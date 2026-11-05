import { Array, Duration, Option, Record, Stream } from 'effect'
import { Runtime, Subscription, type Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import {
  FetchDevices,
  FetchInfo,
  ScanDevices,
  SetBrightness,
  SetCookMode,
  SetPower,
  SetupWifi,
} from './command'
import type { Device } from './domain'
import { Message } from './message'
import {
  DeviceList,
  InfoPanel,
  type Model,
  Scan,
  WifiSubmission,
  cookMinutesFor,
  initialModel,
} from './model'

export { Message } from './message'
export { Model } from './model'

const replaceDevice = (deviceList: DeviceList, device: Device): DeviceList =>
  DeviceList.match(deviceList, {
    Loading: () => DeviceList.Loaded({ devices: [device] }),
    Failed: () => DeviceList.Loaded({ devices: [device] }),
    Loaded: ({ devices }) =>
      DeviceList.Loaded({
        devices: Array.map(devices, existing =>
          existing.id === device.id ? device : existing,
        ),
      }),
  })

const startDeviceAction = (model: Model, deviceId: string): Model =>
  modifyFields(model, {
    pendingDeviceIds: ids => Array.append(ids, deviceId),
    maybeActionError: () => Option.none(),
  })

const finishDeviceAction = (model: Model, deviceId: string): Model =>
  modifyFields(model, {
    pendingDeviceIds: ids => Array.filter(ids, id => id !== deviceId),
  })

const isDevicePending = (model: Model, deviceId: string): boolean =>
  Array.contains(model.pendingDeviceIds, deviceId)

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    TickedRefresh: () =>
      Scan.match(model.scan, {
        Scanning: () => ({ model }),
        Idle: () =>
          Array.isReadonlyArrayNonEmpty(model.pendingDeviceIds)
            ? { model }
            : { model, commands: [FetchDevices()] },
      }),

    SucceededFetchDevices: ({ devices }) =>
      Array.isReadonlyArrayNonEmpty(model.pendingDeviceIds)
        ? { model }
        : {
            model: modifyFields(model, {
              deviceList: () => DeviceList.Loaded({ devices }),
            }),
          },

    FailedFetchDevices: ({ error }) => ({
      model: modifyFields(model, {
        deviceList: () => DeviceList.Failed({ error }),
      }),
    }),

    ClickedRescan: () =>
      Scan.match(model.scan, {
        Scanning: () => ({ model }),
        Idle: () => ({
          model: modifyFields(model, { scan: () => Scan.Scanning() }),
          commands: [ScanDevices()],
        }),
      }),

    SucceededScanDevices: ({ devices }) => ({
      model: modifyFields(model, {
        scan: () => Scan.Idle(),
        deviceList: () => DeviceList.Loaded({ devices }),
      }),
    }),

    FailedScanDevices: ({ error }) => ({
      model: modifyFields(model, {
        scan: () => Scan.Idle(),
        deviceList: () => DeviceList.Failed({ error }),
      }),
    }),

    ClickedPower: ({ deviceId, isOn }) =>
      isDevicePending(model, deviceId)
        ? { model }
        : {
            model: startDeviceAction(model, deviceId),
            commands: [SetPower({ deviceId, isOn })],
          },

    ChangedBrightness: ({ deviceId, level }) =>
      isDevicePending(model, deviceId)
        ? { model }
        : {
            model: startDeviceAction(model, deviceId),
            commands: [SetBrightness({ deviceId, level })],
          },

    SelectedCookMinutes: ({ deviceId, minutes }) => ({
      model: modifyFields(model, {
        cookMinutesByDevice: byDevice =>
          Record.set(byDevice, deviceId, minutes),
      }),
    }),

    ClickedCookMode: ({ deviceId, mode }) =>
      isDevicePending(model, deviceId)
        ? { model }
        : {
            model: startDeviceAction(model, deviceId),
            commands: [
              SetCookMode({
                deviceId,
                mode,
                minutes: cookMinutesFor(model, deviceId),
              }),
            ],
          },

    SucceededDeviceAction: ({ device }) => ({
      model: modifyFields(finishDeviceAction(model, device.id), {
        deviceList: deviceList => replaceDevice(deviceList, device),
      }),
    }),

    FailedDeviceAction: ({ deviceId, error }) => ({
      model: modifyFields(finishDeviceAction(model, deviceId), {
        maybeActionError: () => Option.some(error),
      }),
    }),

    ClickedDismissError: () => ({
      model: modifyFields(model, { maybeActionError: () => Option.none() }),
    }),

    ClickedShowInfo: ({ deviceId }) => ({
      model: modifyFields(model, {
        infoPanel: () => InfoPanel.Loading({ deviceId }),
      }),
      commands: [FetchInfo({ deviceId })],
    }),

    ClickedHideInfo: () => ({
      model: modifyFields(model, { infoPanel: () => InfoPanel.Closed() }),
    }),

    SucceededFetchInfo: ({ deviceId, services }) =>
      InfoPanel.matchOrElse(
        model.infoPanel,
        {
          Loading: loading =>
            loading.deviceId === deviceId
              ? {
                  model: modifyFields(model, {
                    infoPanel: () => InfoPanel.Loaded({ deviceId, services }),
                  }),
                }
              : { model },
        },
        () => ({ model }),
      ),

    FailedFetchInfo: ({ deviceId, error }) =>
      InfoPanel.matchOrElse(
        model.infoPanel,
        {
          Loading: loading =>
            loading.deviceId === deviceId
              ? {
                  model: modifyFields(model, {
                    infoPanel: () => InfoPanel.Failed({ deviceId, error }),
                  }),
                }
              : { model },
        },
        () => ({ model }),
      ),

    UpdatedWifiSsid: ({ value }) => ({
      model: modifyFields(model, {
        wifi: wifi => modifyFields(wifi, { ssid: () => value }),
      }),
    }),

    UpdatedWifiPassword: ({ value }) => ({
      model: modifyFields(model, {
        wifi: wifi => modifyFields(wifi, { password: () => value }),
      }),
    }),

    UpdatedWifiHost: ({ value }) => ({
      model: modifyFields(model, {
        wifi: wifi => modifyFields(wifi, { host: () => value }),
      }),
    }),

    SubmittedWifiForm: () =>
      WifiSubmission.guards.Submitting(model.wifi.submission) ||
      model.wifi.ssid.trim() === ''
        ? { model }
        : {
            model: modifyFields(model, {
              wifi: wifi =>
                modifyFields(wifi, {
                  submission: () => WifiSubmission.Submitting(),
                }),
            }),
            commands: [
              SetupWifi({
                ssid: model.wifi.ssid.trim(),
                password: model.wifi.password,
                host: model.wifi.host.trim(),
              }),
            ],
          },

    SucceededSetupWifi: ({ status, message }) => ({
      model: modifyFields(model, {
        wifi: wifi =>
          modifyFields(wifi, {
            password: () => '',
            submission: () => WifiSubmission.Succeeded({ status, message }),
          }),
      }),
    }),

    FailedSetupWifi: ({ error }) => ({
      model: modifyFields(model, {
        wifi: wifi =>
          modifyFields(wifi, {
            submission: () => WifiSubmission.Failed({ error }),
          }),
      }),
    }),
  })

// INIT

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: initialModel,
  commands: [FetchDevices()],
})

// SUBSCRIPTION

const REFRESH_INTERVAL = Duration.seconds(5)

export const subscriptions = Subscription.make<Model, Message>()(entry => ({
  refresh: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () =>
        Stream.tick(REFRESH_INTERVAL).pipe(
          Stream.drop(1),
          Stream.map(() => Message.TickedRefresh()),
        ),
    },
  ),
}))

export { view } from './view'
