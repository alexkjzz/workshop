export interface Telemetry {
  temperature?: number;
  humidity?: number;
  gas?: number;
  presence?: boolean;
}

export interface DeviceStatus {
  mqttConnected: boolean;
  lastMessageAt: string | null;
  telemetry: Telemetry | null;
}

export type DeviceCommand = 'ON' | 'OFF';