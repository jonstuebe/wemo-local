import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { expect, test } from 'vitest'

import { FetchDevices, SetCookMode, SetupWifi } from './command'
import { Device } from './domain'
import { Message, update } from './main'
import { DeviceList, initialModel } from './model'

const slowCooker = Device.CrockPot({
  id: 'uuid:Crockpot-1',
  name: 'Slow cooker',
  model: 'Crockpot',
  host: '192.168.86.36',
  port: 49153,
  serial: 'ABC',
  firmware: 'fw',
  mode: 'Off',
  remainingMinutes: 0,
  cookedMinutes: 0,
})

const loadedModel = {
  ...initialModel,
  deviceList: DeviceList.Loaded({ devices: [slowCooker] }),
}

test('choosing Low cooks for the selected time and shows the new state', () => {
  story(
    update,
    given(loadedModel),
    message(
      Message.SelectedCookMinutes({ deviceId: slowCooker.id, minutes: 480 }),
    ),
    message(Message.ClickedCookMode({ deviceId: slowCooker.id, mode: 'Low' })),
    model(next => {
      expect(next.pendingDeviceIds).toEqual([slowCooker.id])
    }),
    Command.resolve(
      SetCookMode,
      Message.SucceededDeviceAction({
        device: { ...slowCooker, mode: 'Low', remainingMinutes: 480 },
      }),
    ),
    model(next => {
      expect(next.pendingDeviceIds).toEqual([])
      expect(next.deviceList).toEqual(
        DeviceList.Loaded({
          devices: [{ ...slowCooker, mode: 'Low', remainingMinutes: 480 }],
        }),
      )
    }),
  )
})

test('a failed device action surfaces an error', () => {
  story(
    update,
    given(loadedModel),
    message(Message.ClickedCookMode({ deviceId: slowCooker.id, mode: 'High' })),
    Command.resolve(
      SetCookMode,
      Message.FailedDeviceAction({
        deviceId: slowCooker.id,
        error: 'Slow cooker: timed out',
      }),
    ),
    model(next => {
      expect(next.maybeActionError).toEqual(
        Option.some('Slow cooker: timed out'),
      )
      expect(next.pendingDeviceIds).toEqual([])
    }),
  )
})

test('refresh ticks fetch devices', () => {
  story(
    update,
    given(loadedModel),
    message(Message.TickedRefresh()),
    Command.resolve(
      FetchDevices,
      Message.SucceededFetchDevices({ devices: [slowCooker] }),
    ),
  )
})

test('wifi setup submits the trimmed form', () => {
  story(
    update,
    given(loadedModel),
    message(Message.UpdatedWifiSsid({ value: ' Home ' })),
    message(Message.UpdatedWifiPassword({ value: 'secret' })),
    message(Message.SubmittedWifiForm()),
    Command.resolve(
      SetupWifi,
      Message.SucceededSetupWifi({ status: 'connected', message: 'ok' }),
    ),
    model(next => {
      expect(next.wifi.password).toBe('')
      expect(next.wifi.submission._tag).toBe('Succeeded')
    }),
  )
})
