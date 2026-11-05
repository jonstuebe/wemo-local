import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

export const CrockPotMode = Schema.Literals(['Off', 'Warm', 'Low', 'High'])
export type CrockPotMode = typeof CrockPotMode.Type

export const CROCKPOT_MODES: ReadonlyArray<CrockPotMode> = [
  'Off',
  'Warm',
  'Low',
  'High',
]

const deviceFields = {
  id: Schema.String,
  name: Schema.String,
  model: Schema.String,
  host: Schema.String,
  port: Schema.Number,
  serial: Schema.String,
  firmware: Schema.String,
}

export const Device = defineTaggedUnion({
  Switch: { ...deviceFields, isOn: Schema.Boolean },
  Dimmer: { ...deviceFields, isOn: Schema.Boolean, brightness: Schema.Number },
  CrockPot: {
    ...deviceFields,
    mode: CrockPotMode,
    remainingMinutes: Schema.Number,
    cookedMinutes: Schema.Number,
  },
})
export type Device = typeof Device.Type

export const ServiceAction = Schema.Struct({
  name: Schema.String,
  args: Schema.Array(Schema.String),
  returns: Schema.Array(Schema.String),
})
export type ServiceAction = typeof ServiceAction.Type

export const Service = Schema.Struct({
  name: Schema.String,
  actions: Schema.Array(ServiceAction),
})
export type Service = typeof Service.Type

export const DEFAULT_COOK_MINUTES = 240

export const isTimedMode = (mode: CrockPotMode): boolean =>
  mode === 'Low' || mode === 'High'

export const formatMinutes = (minutes: number): string =>
  `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
