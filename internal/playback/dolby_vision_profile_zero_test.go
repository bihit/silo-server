package playback

import "testing"

func TestValidateHDRCapabilitiesAcceptsLegacyDolbyVisionProfileZero(t *testing.T) {
	hdr := &HDRCapabilitiesV3{
		DolbyVisionProfiles: []int{0, 5, 8},
		DolbyVisionProfileLevels: []DolbyVisionProfileCapabilityV3{
			{Profile: 0, MaxLevel: 6},
			{Profile: 5, MaxLevel: 9},
			{Profile: 8, MaxLevel: 9},
		},
	}
	if err := validateHDRCapabilitiesV3(hdr); err != nil {
		t.Fatalf("legacy profile 0 refused: %v", err)
	}
	for _, bad := range []DolbyVisionProfileCapabilityV3{{Profile: -1, MaxLevel: 6}, {Profile: 8, MaxLevel: 0}, {Profile: 8, MaxLevel: 14}} {
		if err := validateHDRCapabilitiesV3(&HDRCapabilitiesV3{DolbyVisionProfileLevels: []DolbyVisionProfileCapabilityV3{bad}}); err == nil {
			t.Fatalf("invalid capability %+v accepted", bad)
		}
	}
}
