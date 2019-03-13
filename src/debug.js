import KSPackage from "./";
import {Version} from "./Version";
import KSPInstallation from "./Installation";

const kspVersion = new Version('1.4.2');
const installation = new KSPInstallation(process.env.HOME + '/Downloads/KSP', kspVersion);
// const installation = new KSPInstallation(process.env.HOME + '/Library/Application Support/Steam/steamapps/common/Kerbal Space Program');
const kspackage = new KSPackage(installation);
kspackage.kspVersion = kspVersion;

init().then(() => {});

async function init() {
    // Load repo from cache or fetch it
    console.time('kspackageInit');
    await kspackage.init();
    console.timeEnd('kspackageInit');

    // const results = kspackage.repository.searchForCompatibleMod("Astronomers", kspVersion);
    // console.log(results.map(m => m.name))
    await resolvingExample();
}

async function resolvingExample() {
    // Queue mod for install
    // kspackage.queueForRemoval('AstronomersVisualPack');
    kspackage.queueForInstallation('AstronomersVisualPack');
    kspackage.queueForInstallation('Scatterer');
    kspackage.queueForInstallation('kOS');
    kspackage.queueForInstallation('NearFutureSolar');
    kspackage.queueForInstallation('NearFutureElectrical');
    kspackage.queueForInstallation('NearFuturePropulsion');
    kspackage.queueForInstallation('NearFutureSpacecraft');
    kspackage.queueForInstallation('Firespitter');
    kspackage.queueForInstallation('SmartParts');
    kspackage.queueForInstallation('kRPC');
    kspackage.queueForInstallation('VesselView');

    // Get resolver
    await kspackage.applyChangeSet(async choice => {
        console.log(`Choices to satisfy feature '${choice.feature}' for mod '${choice.mod}':`);
        choice.choices.forEach((choice, id) => console.log(id, choice));

        const selected = await waitForInput();

        choice.select(choice.choices[selected]);
    });
}

function waitForInput() {
    return new Promise(resolve => {
        process.stdin.resume();

        process.stdin.once('data', function (data) {
            process.stdin.pause();
            resolve(data.toString().trim());
        });
    })
}

// console.dir(tree, {depth: null, colors: true});