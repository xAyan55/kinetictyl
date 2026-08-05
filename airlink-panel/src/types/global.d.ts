declare global {
    namespace NodeJS {
      interface Global {
        uiComponentStore: any;
        name: string;
        cynexgpVersion: string;
        adminMenuItems: any[];
        regularMenuItems: any[];
      }
    }
  }
  
export {};