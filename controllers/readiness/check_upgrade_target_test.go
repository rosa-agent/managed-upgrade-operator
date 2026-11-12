package readiness

import (
	"context"
	"fmt"
	"time"

	configv1 "github.com/openshift/api/config/v1"
	upgradev1alpha1 "github.com/openshift/managed-upgrade-operator/api/v1alpha1"
	cvMocks "github.com/openshift/managed-upgrade-operator/pkg/clusterversion/mocks"
	"github.com/openshift/managed-upgrade-operator/util/mocks"
	"go.uber.org/mock/gomock"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
)

// completedCV returns a ClusterVersion with one completed history entry at the given
// version. AvailableUpdates and ConditionalUpdates can be set by the caller.
func completedCV(currentVersion, channel string) *configv1.ClusterVersion {
	t := metav1.NewTime(time.Now())
	return &configv1.ClusterVersion{
		Spec: configv1.ClusterVersionSpec{
			Channel:   channel,
			ClusterID: "11111111-1111-1111-1111-111111111111",
			Upstream:  "http://127.0.0.1:0/graph", // unreachable — forces Cincinnati error
		},
		Status: configv1.ClusterVersionStatus{
			History: []configv1.UpdateHistory{
				{
					State:          configv1.CompletedUpdate,
					Version:        currentVersion,
					CompletionTime: &t,
				},
			},
		},
	}
}

var _ = Describe("upgrade target checks", func() {
	var (
		mockCtrl    *gomock.Controller
		mockClient  *mocks.MockClient
		mockCvBuilder *cvMocks.MockClusterVersionBuilder
		mockCv      *cvMocks.MockClusterVersion
	)

	BeforeEach(func() {
		mockCtrl = gomock.NewController(GinkgoT())
		mockClient = mocks.NewMockClient(mockCtrl)
		mockCvBuilder = cvMocks.NewMockClusterVersionBuilder(mockCtrl)
		mockCv = cvMocks.NewMockClusterVersion(mockCtrl)
	})

	AfterEach(func() {
		mockCtrl.Finish()
	})

	// --- helper function unit tests ---

	Describe("classifyUpgradeType", func() {
		It("returns z-stream for same minor version", func() {
			Expect(classifyUpgradeType("4.14.10", "4.14.11", "stable-4.14")).To(Equal("z-stream"))
		})
		It("returns y-stream for different minor version", func() {
			Expect(classifyUpgradeType("4.14.10", "4.15.0", "stable-4.15")).To(Equal("y-stream"))
		})
		It("returns eus when channel contains eus", func() {
			Expect(classifyUpgradeType("4.14.10", "4.16.0", "eus-4.16")).To(Equal("eus"))
		})
		It("returns z-stream when semver parse fails (falls back)", func() {
			Expect(classifyUpgradeType("bad", "also-bad", "stable-4.14")).To(Equal("z-stream"))
		})
	})

	Describe("cvoAvailableVersion", func() {
		It("returns true when version is present", func() {
			updates := []configv1.Release{{Version: "4.14.11"}, {Version: "4.14.12"}}
			Expect(cvoAvailableVersion("4.14.11", updates)).To(BeTrue())
		})
		It("returns false when version is absent", func() {
			updates := []configv1.Release{{Version: "4.14.12"}}
			Expect(cvoAvailableVersion("4.14.11", updates)).To(BeFalse())
		})
	})

	Describe("conditionalRecommended", func() {
		It("returns recommended=true when Recommended condition is True", func() {
			u := &configv1.ConditionalUpdate{
				Conditions: []metav1.Condition{
					{Type: "Recommended", Status: metav1.ConditionTrue},
				},
			}
			rec, eval, _ := conditionalRecommended(u)
			Expect(eval).To(BeTrue())
			Expect(rec).To(BeTrue())
		})
		It("returns recommended=false when Recommended condition is False", func() {
			u := &configv1.ConditionalUpdate{
				Conditions: []metav1.Condition{
					{Type: "Recommended", Status: metav1.ConditionFalse, Message: "risk applies"},
				},
			}
			rec, eval, msg := conditionalRecommended(u)
			Expect(eval).To(BeTrue())
			Expect(rec).To(BeFalse())
			Expect(msg).To(ContainSubstring("risk applies"))
		})
		It("returns evaluated=false when no Recommended condition present", func() {
			u := &configv1.ConditionalUpdate{}
			_, eval, _ := conditionalRecommended(u)
			Expect(eval).To(BeFalse())
		})
	})

	Describe("describeCVOStatus", func() {
		It("returns available when avail=true", func() {
			status, risks := describeCVOStatus("4.14.11", true, nil)
			Expect(status).To(Equal("available"))
			Expect(risks).To(BeNil())
		})
		It("returns not-found when avail=false and cond=nil", func() {
			status, _ := describeCVOStatus("4.14.11", false, nil)
			Expect(status).To(Equal("not-found"))
		})
		It("returns conditional (not recommended) when risk applies", func() {
			cond := &configv1.ConditionalUpdate{
				Conditions: []metav1.Condition{
					{Type: "Recommended", Status: metav1.ConditionFalse, Message: "risk applies"},
				},
			}
			status, _ := describeCVOStatus("4.14.11", false, cond)
			Expect(status).To(ContainSubstring("not recommended"))
		})
	})

	// --- upgradeTargetCheck ---

	Describe("upgradeTargetCheck", func() {
		var check *upgradeTargetCheck
		BeforeEach(func() { check = &upgradeTargetCheck{} })

		It("returns Error when GetClusterVersion fails", func() {
			deps := CheckDependencies{Client: mockClient, CvClientBuilder: mockCvBuilder}
			mockCvBuilder.EXPECT().New(gomock.Any()).Return(mockCv)
			mockCv.EXPECT().GetClusterVersion().Return(nil, fmt.Errorf("cvo unavailable"))
			out := check.Run(context.TODO(), deps, log, defaultCheckTimeout)
			Expect(out.Result).To(Equal(upgradev1alpha1.CheckResultError))
			Expect(out.Error).To(ContainSubstring("cvo unavailable"))
		})

		It("returns Passed when version is in AvailableUpdates", func() {
			cv := completedCV("4.14.10", "stable-4.14")
			cv.Status.AvailableUpdates = []configv1.Release{{Version: "4.14.11"}}
			deps := CheckDependencies{
				Client:          mockClient,
				CvClientBuilder: mockCvBuilder,
				DesiredVersion:  "4.14.11",
				DesiredChannel:  "stable-4.14",
			}
			mockCvBuilder.EXPECT().New(gomock.Any()).Return(mockCv)
			mockCv.EXPECT().GetClusterVersion().Return(cv, nil)
			out := check.Run(context.TODO(), deps, log, defaultCheckTimeout)
			Expect(out.Result).To(Equal(upgradev1alpha1.CheckPassed))
			Expect(out.Findings).To(ContainElement("targetVersion=4.14.11"))
		})

		It("returns Failed when version is not found", func() {
			cv := completedCV("4.14.10", "stable-4.14")
			deps := CheckDependencies{
				Client:          mockClient,
				CvClientBuilder: mockCvBuilder,
				DesiredVersion:  "4.14.99",
				DesiredChannel:  "stable-4.14",
			}
			mockCvBuilder.EXPECT().New(gomock.Any()).Return(mockCv)
			mockCv.EXPECT().GetClusterVersion().Return(cv, nil)
			out := check.Run(context.TODO(), deps, log, defaultCheckTimeout)
			Expect(out.Result).To(Equal(upgradev1alpha1.CheckFailed))
		})

		It("returns Failed when conditional update is not recommended for this cluster", func() {
			cv := completedCV("4.14.10", "stable-4.14")
			cv.Status.ConditionalUpdates = []configv1.ConditionalUpdate{
				{
					Release: configv1.Release{Version: "4.14.11"},
					Conditions: []metav1.Condition{
						{Type: "Recommended", Status: metav1.ConditionFalse, Message: "risk applies to cluster"},
					},
				},
			}
			deps := CheckDependencies{
				Client:          mockClient,
				CvClientBuilder: mockCvBuilder,
				DesiredVersion:  "4.14.11",
				DesiredChannel:  "stable-4.14",
			}
			mockCvBuilder.EXPECT().New(gomock.Any()).Return(mockCv)
			mockCv.EXPECT().GetClusterVersion().Return(cv, nil)
			out := check.Run(context.TODO(), deps, log, defaultCheckTimeout)
			Expect(out.Result).To(Equal(upgradev1alpha1.CheckFailed))
			Expect(out.Summary).To(ContainSubstring("not recommended"))
		})

		It("returns Passed for conditional update with no Recommended condition evaluated yet", func() {
			cv := completedCV("4.14.10", "stable-4.14")
			cv.Status.ConditionalUpdates = []configv1.ConditionalUpdate{
				{
					Release:    configv1.Release{Version: "4.14.11"},
					Conditions: []metav1.Condition{}, // CVO hasn't evaluated yet
				},
			}
			deps := CheckDependencies{
				Client:          mockClient,
				CvClientBuilder: mockCvBuilder,
				DesiredVersion:  "4.14.11",
				DesiredChannel:  "stable-4.14",
			}
			mockCvBuilder.EXPECT().New(gomock.Any()).Return(mockCv)
			mockCv.EXPECT().GetClusterVersion().Return(cv, nil)
			out := check.Run(context.TODO(), deps, log, defaultCheckTimeout)
			Expect(out.Result).To(Equal(upgradev1alpha1.CheckPassed))
		})

		It("returns Failed for a downgrade", func() {
			cv := completedCV("4.14.11", "stable-4.14")
			deps := CheckDependencies{
				Client:          mockClient,
				CvClientBuilder: mockCvBuilder,
				DesiredVersion:  "4.14.10",
				DesiredChannel:  "stable-4.14",
			}
			mockCvBuilder.EXPECT().New(gomock.Any()).Return(mockCv)
			mockCv.EXPECT().GetClusterVersion().Return(cv, nil)
			out := check.Run(context.TODO(), deps, log, defaultCheckTimeout)
			Expect(out.Result).To(Equal(upgradev1alpha1.CheckFailed))
		})
	})

	// --- upgradeTargetExtendedCheck ---

	Describe("upgradeTargetExtendedCheck", func() {
		var check *upgradeTargetExtendedCheck
		BeforeEach(func() { check = &upgradeTargetExtendedCheck{} })

		It("returns Error when GetClusterVersion fails", func() {
			deps := CheckDependencies{Client: mockClient, CvClientBuilder: mockCvBuilder}
			mockCvBuilder.EXPECT().New(gomock.Any()).Return(mockCv)
			mockCv.EXPECT().GetClusterVersion().Return(nil, fmt.Errorf("cvo unavailable"))
			out := check.Run(context.TODO(), deps, log, defaultCheckTimeout)
			Expect(out.Result).To(Equal(upgradev1alpha1.CheckResultError))
			Expect(out.Error).To(ContainSubstring("cvo unavailable"))
		})

		It("returns Warning when Cincinnati unreachable but version is in CVO AvailableUpdates", func() {
			// Spec.Upstream points to :0 which is always unreachable
			cv := completedCV("4.14.10", "stable-4.14")
			cv.Status.AvailableUpdates = []configv1.Release{{Version: "4.14.11"}}
			deps := CheckDependencies{
				Client:          mockClient,
				CvClientBuilder: mockCvBuilder,
				DesiredVersion:  "4.14.11",
				DesiredChannel:  "stable-4.14",
			}
			mockCvBuilder.EXPECT().New(gomock.Any()).Return(mockCv)
			mockCv.EXPECT().GetClusterVersion().Return(cv, nil)
			out := check.Run(context.TODO(), deps, log, defaultCheckTimeout)
			Expect(out.Result).To(Equal(upgradev1alpha1.CheckResultWarning))
			Expect(out.Summary).To(ContainSubstring("Cincinnati query failed"))
		})

		It("returns Error when Cincinnati unreachable and version not in CVO cache", func() {
			cv := completedCV("4.14.10", "stable-4.14")
			deps := CheckDependencies{
				Client:          mockClient,
				CvClientBuilder: mockCvBuilder,
				DesiredVersion:  "4.14.11",
				DesiredChannel:  "stable-4.14",
			}
			mockCvBuilder.EXPECT().New(gomock.Any()).Return(mockCv)
			mockCv.EXPECT().GetClusterVersion().Return(cv, nil)
			out := check.Run(context.TODO(), deps, log, defaultCheckTimeout)
			Expect(out.Result).To(Equal(upgradev1alpha1.CheckResultError))
			Expect(out.Error).To(ContainSubstring("Cincinnati unreachable"))
		})

		It("includes upgrade type classification in findings", func() {
			cv := completedCV("4.14.10", "stable-4.14")
			cv.Status.AvailableUpdates = []configv1.Release{{Version: "4.14.11"}}
			deps := CheckDependencies{
				Client:          mockClient,
				CvClientBuilder: mockCvBuilder,
				DesiredVersion:  "4.14.11",
				DesiredChannel:  "stable-4.14",
			}
			mockCvBuilder.EXPECT().New(gomock.Any()).Return(mockCv)
			mockCv.EXPECT().GetClusterVersion().Return(cv, nil)
			out := check.Run(context.TODO(), deps, log, defaultCheckTimeout)
			Expect(out.Findings).To(ContainElement("upgradeType=z-stream"))
		})

		It("returns Failed when conditional risk applies (CVO evaluated, not recommended)", func() {
			cv := completedCV("4.14.10", "stable-4.14")
			cv.Status.ConditionalUpdates = []configv1.ConditionalUpdate{
				{
					Release: configv1.Release{Version: "4.14.11"},
					Conditions: []metav1.Condition{
						{Type: "Recommended", Status: metav1.ConditionFalse, Message: "risk applies to cluster"},
					},
				},
			}
			deps := CheckDependencies{
				Client:          mockClient,
				CvClientBuilder: mockCvBuilder,
				DesiredVersion:  "4.14.11",
				DesiredChannel:  "stable-4.14",
			}
			mockCvBuilder.EXPECT().New(gomock.Any()).Return(mockCv)
			mockCv.EXPECT().GetClusterVersion().Return(cv, nil)
			out := check.Run(context.TODO(), deps, log, defaultCheckTimeout)
			Expect(out.Result).To(Equal(upgradev1alpha1.CheckFailed))
			Expect(out.Summary).To(ContainSubstring("risk applies"))
		})
	})
})
