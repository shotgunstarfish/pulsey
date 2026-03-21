/** Device controller interface — abstraction over hardware */

export interface DeviceController {
  connect(): Promise<void>;
  vibrate(strength: number, toyId?: string): Promise<void>;  // 0-20; toyId='' broadcasts to all toys
  stop(toyId?: string): Promise<void>;
  disconnect(): void;
}
