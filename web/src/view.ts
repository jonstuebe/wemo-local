import { Array, Option } from 'effect'
import { Document, Html, HtmlBuilder } from 'foldkit/html'

import {
  CROCKPOT_MODES,
  type CrockPotMode,
  Device,
  type Service,
  formatMinutes,
  isTimedMode,
} from './domain'
import { Message } from './message'
import {
  DeviceList,
  InfoPanel,
  type Model,
  Scan,
  WifiSubmission,
  cookMinutesFor,
} from './model'

type Switch = typeof Device.Switch.Type
type Dimmer = typeof Device.Dimmer.Type
type CrockPot = typeof Device.CrockPot.Type

const COOK_TIME_OPTIONS: ReadonlyArray<number> = Array.makeBy(
  40,
  index => (index + 1) * 30,
)

const buttonBase =
  'rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600'

const secondaryButton = `${buttonBase} border border-stone-300 bg-white text-stone-700 hover:bg-stone-50`

// VIEW

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'WeMo',
  body: h.div(
    [h.Class('min-h-screen bg-stone-100 text-stone-900')],
    [
      h.main(
        [h.Class('mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8')],
        [
          headerView(model, h),
          Option.match(model.maybeActionError, {
            onNone: () => h.empty,
            onSome: error => errorBannerView(error, h),
          }),
          deviceListView(model, h),
          wifiSetupView(model, h),
        ],
      ),
    ],
  ),
})

const headerView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.header(
    [h.Class('flex items-end justify-between gap-4')],
    [
      h.div(
        [],
        [
          h.h1([h.Class('text-3xl font-bold tracking-tight')], ['WeMo']),
          h.p(
            [h.Class('text-sm text-stone-500')],
            ['Local control on your network. No Belkin cloud.'],
          ),
        ],
      ),
      h.button(
        [
          h.Class(secondaryButton),
          h.Type('button'),
          h.Disabled(Scan.guards.Scanning(model.scan)),
          h.OnClick(Message.ClickedRescan()),
        ],
        [
          Scan.match(model.scan, {
            Idle: () => 'Rescan network',
            Scanning: () => 'Scanning…',
          }),
        ],
      ),
    ],
  )

const errorBannerView = (error: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Role('alert'),
      h.Class(
        'flex items-start justify-between gap-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800',
      ),
    ],
    [
      h.span([], [error]),
      h.button(
        [
          h.Class('font-medium underline'),
          h.Type('button'),
          h.OnClick(Message.ClickedDismissError()),
        ],
        ['Dismiss'],
      ),
    ],
  )

const deviceListView = (model: Model, h: HtmlBuilder<Message>): Html =>
  DeviceList.match(model.deviceList, {
    Loading: () =>
      h.p(
        [h.Class('py-12 text-center text-stone-500'), h.AriaLive('polite')],
        ['Searching your network for WeMo devices…'],
      ),
    Failed: ({ error }) =>
      h.div(
        [
          h.Role('alert'),
          h.Class(
            'rounded-xl border border-red-300 bg-red-50 p-6 text-red-800',
          ),
        ],
        [error],
      ),
    Loaded: ({ devices }) =>
      Array.match(devices, {
        onEmpty: () =>
          h.p(
            [h.Class('py-12 text-center text-stone-500')],
            [
              'No WeMo devices found. Make sure this computer is on the same network, then rescan.',
            ],
          ),
        onNonEmpty: nonEmpty =>
          h.ul(
            [h.Class('flex flex-col gap-4'), h.AriaLabel('Devices')],
            Array.map(nonEmpty, device =>
              h.keyed('li')(device.id, [], [deviceCardView(model, device, h)]),
            ),
          ),
      }),
  })

const deviceCardView = (
  model: Model,
  device: Device,
  h: HtmlBuilder<Message>,
): Html => {
  const isPending = Array.contains(model.pendingDeviceIds, device.id)
  return h.article(
    [
      h.AriaLabel(device.name),
      h.AriaBusy(isPending),
      h.Class(
        'flex flex-col gap-5 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm',
      ),
    ],
    [
      h.div(
        [h.Class('flex items-start justify-between gap-4')],
        [
          h.div(
            [],
            [
              h.h2([h.Class('text-xl font-semibold')], [device.name]),
              h.p(
                [h.Class('text-sm text-stone-500')],
                [`${device.model} · ${device.host}`],
              ),
            ],
          ),
          statusPillView(device, h),
        ],
      ),
      Device.match(device, {
        Switch: switchDevice => switchControlsView(switchDevice, isPending, h),
        Dimmer: dimmer => dimmerControlsView(dimmer, isPending, h),
        CrockPot: crockPot =>
          crockPotControlsView(
            crockPot,
            cookMinutesFor(model, crockPot.id),
            isPending,
            h,
          ),
      }),
      deviceFooterView(model, device, h),
    ],
  )
}

const statusPillView = (device: Device, h: HtmlBuilder<Message>): Html => {
  const isActive = Device.match(device, {
    Switch: ({ isOn }) => isOn,
    Dimmer: ({ isOn }) => isOn,
    CrockPot: ({ mode }) => mode !== 'Off',
  })
  const label = Device.match(device, {
    Switch: ({ isOn }) => (isOn ? 'On' : 'Off'),
    Dimmer: ({ isOn, brightness }) => (isOn ? `On · ${brightness}%` : 'Off'),
    CrockPot: ({ mode }) => mode,
  })
  return h.span(
    [
      h.Class(
        isActive
          ? 'rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800'
          : 'rounded-full bg-stone-100 px-3 py-1 text-sm font-semibold text-stone-500',
      ),
    ],
    [label],
  )
}

const powerButtonView = (
  deviceId: string,
  isOn: boolean,
  isPending: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.AriaPressed(isOn ? 'true' : 'false'),
      h.Disabled(isPending),
      h.OnClick(Message.ClickedPower({ deviceId, isOn: !isOn })),
      h.Class(
        `${buttonBase} w-full py-3 text-base ${
          isOn
            ? 'bg-amber-500 text-white hover:bg-amber-600'
            : 'bg-stone-800 text-white hover:bg-stone-700'
        }`,
      ),
    ],
    [isOn ? 'Turn off' : 'Turn on'],
  )

const switchControlsView = (
  device: Switch,
  isPending: boolean,
  h: HtmlBuilder<Message>,
): Html => powerButtonView(device.id, device.isOn, isPending, h)

const dimmerControlsView = (
  device: Dimmer,
  isPending: boolean,
  h: HtmlBuilder<Message>,
): Html => {
  const sliderId = `brightness-${device.id}`
  return h.div(
    [h.Class('flex flex-col gap-4')],
    [
      powerButtonView(device.id, device.isOn, isPending, h),
      h.div(
        [h.Class('flex flex-col gap-2')],
        [
          h.label(
            [h.For(sliderId), h.Class('text-sm font-medium text-stone-600')],
            [`Brightness: ${device.brightness}%`],
          ),
          h.input([
            h.Id(sliderId),
            h.Type('range'),
            h.Min('0'),
            h.Max('100'),
            h.Step('1'),
            h.Value(String(device.brightness)),
            h.Disabled(isPending),
            h.Class('w-full accent-amber-500'),
            h.OnChange(value =>
              Message.ChangedBrightness({
                deviceId: device.id,
                level: Number(value),
              }),
            ),
          ]),
        ],
      ),
    ],
  )
}

const crockPotControlsView = (
  device: CrockPot,
  cookMinutes: number,
  isPending: boolean,
  h: HtmlBuilder<Message>,
): Html => {
  const selectId = `cook-time-${device.id}`
  return h.div(
    [h.Class('flex flex-col gap-5')],
    [
      h.dl(
        [h.Class('grid grid-cols-2 gap-3')],
        [
          statView('Time left', timeLeftLabel(device), h),
          statView('Cooked so far', formatMinutes(device.cookedMinutes), h),
        ],
      ),
      h.div(
        [h.Class('flex flex-col gap-2')],
        [
          h.label(
            [h.For(selectId), h.Class('text-sm font-medium text-stone-600')],
            ['Cook time for Low and High'],
          ),
          h.select(
            [
              h.Id(selectId),
              h.Class(
                'rounded-lg border border-stone-300 bg-white px-3 py-2 text-base',
              ),
              h.OnChange(value =>
                Message.SelectedCookMinutes({
                  deviceId: device.id,
                  minutes: Number(value),
                }),
              ),
            ],
            Array.map(COOK_TIME_OPTIONS, minutes =>
              h.option(
                [h.Value(String(minutes)), h.Selected(minutes === cookMinutes)],
                [formatMinutes(minutes)],
              ),
            ),
          ),
        ],
      ),
      h.div(
        [
          h.Role('group'),
          h.AriaLabel('Cooking mode'),
          h.Class('grid grid-cols-4 gap-2'),
        ],
        Array.map(CROCKPOT_MODES, mode =>
          cookModeButtonView(device, mode, cookMinutes, isPending, h),
        ),
      ),
      h.p(
        [h.Class('text-xs text-stone-500')],
        [
          'Low and High run for the cook time above, then the cooker drops to Warm on its own. Warm keeps going until you turn it off.',
        ],
      ),
    ],
  )
}

const timeLeftLabel = (device: CrockPot): string =>
  isTimedMode(device.mode) ? formatMinutes(device.remainingMinutes) : '—'

const statView = (
  label: string,
  value: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('rounded-xl bg-stone-50 p-3')],
    [
      h.dt(
        [h.Class('text-xs uppercase tracking-wide text-stone-500')],
        [label],
      ),
      h.dd([h.Class('text-2xl font-semibold tabular-nums')], [value]),
    ],
  )

const cookModeButtonView = (
  device: CrockPot,
  mode: CrockPotMode,
  cookMinutes: number,
  isPending: boolean,
  h: HtmlBuilder<Message>,
): Html => {
  const isCurrent = device.mode === mode
  return h.button(
    [
      h.Type('button'),
      h.AriaPressed(isCurrent ? 'true' : 'false'),
      h.Disabled(isPending),
      h.Title(
        isTimedMode(mode)
          ? `${mode} for ${formatMinutes(cookMinutes)}`
          : mode === 'Off'
            ? 'Turn the cooker off'
            : 'Keep warm with no timer',
      ),
      h.OnClick(Message.ClickedCookMode({ deviceId: device.id, mode })),
      h.Class(
        `${buttonBase} py-3 ${
          isCurrent
            ? 'bg-amber-500 text-white hover:bg-amber-600'
            : 'border border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
        }`,
      ),
    ],
    [mode],
  )
}

const deviceFooterView = (
  model: Model,
  device: Device,
  h: HtmlBuilder<Message>,
): Html => {
  const isInfoOpen = InfoPanel.match(model.infoPanel, {
    Closed: () => false,
    Loading: ({ deviceId }) => deviceId === device.id,
    Failed: ({ deviceId }) => deviceId === device.id,
    Loaded: ({ deviceId }) => deviceId === device.id,
  })
  return h.div(
    [h.Class('flex flex-col gap-3 border-t border-stone-100 pt-4')],
    [
      h.div(
        [
          h.Class(
            'flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500',
          ),
        ],
        [
          h.span([], [`Serial ${device.serial} · ${device.firmware}`]),
          h.button(
            [
              h.Type('button'),
              h.Class('font-medium text-stone-700 underline'),
              h.OnClick(
                isInfoOpen
                  ? Message.ClickedHideInfo()
                  : Message.ClickedShowInfo({ deviceId: device.id }),
              ),
            ],
            [isInfoOpen ? 'Hide services' : 'Show services'],
          ),
        ],
      ),
      isInfoOpen ? infoPanelView(model.infoPanel, h) : h.empty,
    ],
  )
}

const infoPanelView = (panel: InfoPanel, h: HtmlBuilder<Message>): Html =>
  InfoPanel.match(panel, {
    Closed: () => h.empty,
    Loading: () =>
      h.p([h.Class('text-sm text-stone-500')], ['Loading services…']),
    Failed: ({ error }) =>
      h.p([h.Role('alert'), h.Class('text-sm text-red-700')], [error]),
    Loaded: ({ services }) =>
      h.div(
        [
          h.Class(
            'max-h-80 overflow-auto rounded-lg bg-stone-900 p-4 font-mono text-xs text-stone-100',
          ),
        ],
        Array.map(services, service => serviceView(service, h)),
      ),
  })

const serviceView = (service: Service, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('mb-3')],
    [
      h.p([h.Class('font-semibold text-amber-300')], [service.name]),
      h.ul(
        [h.Class('pl-4')],
        Array.map(service.actions, action =>
          h.li(
            [],
            [
              `${action.name}(${action.args.join(', ')})${
                Array.isReadonlyArrayNonEmpty(action.returns)
                  ? ` → ${action.returns.join(', ')}`
                  : ''
              }`,
            ],
          ),
        ),
      ),
    ],
  )

const wifiSetupView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const isSubmitting = WifiSubmission.guards.Submitting(model.wifi.submission)
  return h.details(
    [h.Class('rounded-2xl border border-stone-200 bg-white p-6 shadow-sm')],
    [
      h.summary(
        [h.Class('cursor-pointer font-semibold')],
        ['Set up a reset device on Wi-Fi'],
      ),
      factoryResetBannerView(h),
      h.ol(
        [h.Class('mt-4 list-decimal space-y-1 pl-5 text-sm text-stone-600')],
        [
          h.li(
            [],
            [
              'Factory reset the device so it broadcasts its own “Wemo.XXX” Wi-Fi network.',
            ],
          ),
          h.li(
            [],
            ['Join that network from the computer running the WeMo server.'],
          ),
          h.li([], ['Enter your home Wi-Fi details below and connect.']),
          h.li([], ['Rejoin your home Wi-Fi, then rescan.']),
        ],
      ),
      h.form(
        [
          h.Class('mt-4 flex flex-col gap-3'),
          h.OnSubmit(Message.SubmittedWifiForm()),
        ],
        [
          textFieldView(
            'wifi-ssid',
            'Wi-Fi network name',
            'text',
            model.wifi.ssid,
            value => Message.UpdatedWifiSsid({ value }),
            h,
          ),
          textFieldView(
            'wifi-password',
            'Wi-Fi password',
            'password',
            model.wifi.password,
            value => Message.UpdatedWifiPassword({ value }),
            h,
          ),
          textFieldView(
            'wifi-host',
            'Device address',
            'text',
            model.wifi.host,
            value => Message.UpdatedWifiHost({ value }),
            h,
          ),
          h.button(
            [
              h.Type('submit'),
              h.Disabled(isSubmitting || model.wifi.ssid.trim() === ''),
              h.Class(
                `${buttonBase} bg-stone-800 text-white hover:bg-stone-700`,
              ),
            ],
            [isSubmitting ? 'Connecting… (up to 20s)' : 'Connect device'],
          ),
          WifiSubmission.match(model.wifi.submission, {
            NotSubmitted: () => h.empty,
            Submitting: () => h.empty,
            Succeeded: ({ status, message }) =>
              h.p(
                [h.Role('status'), h.Class('text-sm text-green-700')],
                [`${status}: ${message}`],
              ),
            Failed: ({ error }) =>
              h.p([h.Role('alert'), h.Class('text-sm text-red-700')], [error]),
          }),
        ],
      ),
    ],
  )
}

const factoryResetBannerView = (h: HtmlBuilder<Message>): Html =>
  h.aside(
    [
      h.AriaLabel('How to factory reset'),
      h.Class(
        'mt-4 flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900',
      ),
    ],
    [
      h.p([h.Class('font-semibold')], ['How to factory reset a WeMo device']),
      resetStepsView(
        'Crock-Pot Smart Slow Cooker',
        'Unplug it. Hold the Reset button, plug it back in while still holding, and keep holding for another 10–15 seconds. The Wi-Fi light flashes orange to green, and a “WeMo.SlowCooker.XXX” network appears.',
        h,
      ),
      resetStepsView(
        'Plugs and switches',
        'Unplug it. Hold the power (or Restore) button, plug it back in while still holding, and keep holding for about 5 seconds while it boots. The light blinks orange and white when it’s ready for setup.',
        h,
      ),
      h.p(
        [h.Class('text-xs text-amber-800')],
        [
          'A factory reset erases the device’s name, schedules and Wi-Fi settings. Button timing varies a little by model, so if no “Wemo.XXX” network shows up, try again holding a bit longer.',
        ],
      ),
    ],
  )

const resetStepsView = (
  deviceType: string,
  steps: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.p([], [h.span([h.Class('font-medium')], [`${deviceType}: `]), steps])

const textFieldView = (
  id: string,
  label: string,
  type: string,
  value: string,
  toMessage: (value: string) => Message,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('flex flex-col gap-1')],
    [
      h.label(
        [h.For(id), h.Class('text-sm font-medium text-stone-600')],
        [label],
      ),
      h.input([
        h.Id(id),
        h.Type(type),
        h.Value(value),
        h.Autocomplete('off'),
        h.DataAttribute('1p-ignore', ''),
        h.OnInput(toMessage),
        h.Class(
          'rounded-lg border border-stone-300 px-3 py-2 text-base outline-none focus:border-amber-500',
        ),
      ]),
    ],
  )
